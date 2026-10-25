#include "atlas/core.hpp"
#include <algorithm>
#include <cctype>
#include <cmath>
#include <sstream>
#include <stdexcept>

namespace atlas {
namespace {
std::string trim(std::string s) {
  const auto begin=s.find_first_not_of(" \t\r");
  if(begin==std::string::npos)return {};
  return s.substr(begin,s.find_last_not_of(" \t\r")-begin+1);
}
std::string key(std::string s) {
  s=trim(std::move(s));
  std::string result;
  for(unsigned char c:s)
    if(!std::isspace(c))result+=char(std::toupper(c));
  return result;
}
std::vector<std::string> fields(const std::string &row) {
  std::vector<std::string> out;
  std::size_t start=0;
  for(std::size_t i=0;i<=row.size();++i)if(i==row.size()||row[i]==';') {
    out.push_back(trim(row.substr(start,i-start)));
    start=i+1;
  }
  return out;
}
double number(const std::string &s) {
  std::size_t used=0;
  if(s.empty())throw std::invalid_argument("Empty toll price/length");
  double n=std::stod(s,&used);
  if(used!=s.size() || !std::isfinite(n) || n<0.0)
    throw std::invalid_argument("Invalid toll price/length");
  return n;
}
} // namespace

TollTariffs TollTariffs::parse(std::string_view csv, std::string requestedCountry) {
  if(csv.size()>2*1024*1024 || csv.empty() || requestedCountry.empty())
    throw std::invalid_argument("Invalid toll table");
  TollTariffs table;
  table.country=std::move(requestedCountry);
  std::istringstream stream{std::string(csv)};
  std::string line;
  bool header=false;
  bool countrySeen=false;
  unsigned count=0;
  while(std::getline(stream,line)){
    line=trim(line);
    if(line.empty())continue;
    if(line.front()=='#'){
      auto equals=line.find('=');
      if(equals!=std::string::npos) {
        auto name=trim(line.substr(1,equals-1));
        auto value=trim(line.substr(equals+1));
        if(name=="country") {
          countrySeen=true;
          if(value!=table.country)
            throw std::invalid_argument("Toll table country mismatch");
        }
        if(name=="currency")table.currency=value;
        if(name=="year")table.year=value;
        if(name=="source")table.source=value;
      }
      continue;
    }
    const auto f=fields(line);
    if(!header) {
      if(f!=std::vector<std::string>{"road","section","km","class1","class2","class3","class4"})
        throw std::invalid_argument("Unsupported toll table columns");
      header=true;
      continue;
    }
    if(f.size()!=7 || f[0].empty() || f[1].empty())
      throw std::invalid_argument("Invalid toll section row");
    const auto km=number(f[2]);
    if(km<=0.0)throw std::invalid_argument("Zero toll section length");
    auto &road=table.roadTotals_[key(f[0])];
    road.km+=km;
    for(int cls=0;cls<4;++cls)road.euros[cls]+=number(f[3+cls]);
    if(++count>30000)throw std::invalid_argument("Too many toll sections");
  }
  if(!countrySeen || !header || !count || table.currency.empty() ||
     table.year.empty() || table.source.empty())
    throw std::invalid_argument("Incomplete toll table metadata");
  return table;
}

std::optional<double> TollTariffs::estimate(std::string_view roadRef,
                                           double meters,int vehicleClass) const {
  if(!std::isfinite(meters) || meters<0.0 || vehicleClass<1 || vehicleClass>4)
    return std::nullopt;
  // An OSM road can have multiple refs (e.g. "A5; EN9"). Prefer the first
  // tariff-covered motorway; never default to a fictional euro/km amount.
  std::string token;
  for(std::size_t i=0;i<=roadRef.size();++i){
    const char c=i==roadRef.size()?';':roadRef[i];
    if(c==';'||c==','||c=='/'){
      const auto match=roadTotals_.find(key(token));
      if(match!=roadTotals_.end() && match->second.km>0)
        return meters/1000.0*match->second.euros[vehicleClass-1]/match->second.km;
      token.clear();
    } else token+=c;
  }
  return std::nullopt;
}
} // namespace atlas
