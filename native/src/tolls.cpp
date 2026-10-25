#include "atlas/core.hpp"
#include <algorithm>
#include <cctype>
#include <cmath>
#include <map>
#include <set>
#include <sstream>
#include <stdexcept>

namespace atlas {
namespace {
std::string trim(std::string s) {
  auto begin=s.find_first_not_of(" \t\r");
  return begin==std::string::npos?std::string():s.substr(begin,s.find_last_not_of(" \t\r")-begin+1);
}
std::string key(std::string s) {
  std::string out;
  for(unsigned char c:trim(std::move(s)))if(!std::isspace(c))out+=char(std::toupper(c));
  return out;
}
std::vector<std::string> fields(const std::string &row,char delimiter=';') {
  std::vector<std::string> out;std::size_t start=0;
  for(std::size_t i=0;i<=row.size();++i)if(i==row.size()||row[i]==delimiter){out.push_back(trim(row.substr(start,i-start)));start=i+1;}
  return out;
}
double number(const std::string &s) {
  std::size_t used=0;if(s.empty())throw std::invalid_argument("Empty tariff value");
  double n=std::stod(s,&used);
  if(used!=s.size()||!std::isfinite(n)||n<0||n>1e9)throw std::invalid_argument("Invalid tariff value");
  return n;
}
}
TollTariffs TollTariffs::parse(std::string_view csv,std::string country) {
  if(csv.empty()||csv.size()>2*1024*1024||country.empty())throw std::invalid_argument("Invalid toll table");
  TollTariffs table;table.country=std::move(country);
  std::map<std::string,std::string> metadata;std::set<std::string> sections;
  std::istringstream in{std::string(csv)};std::string line;bool header=false;unsigned rows=0;
  while(std::getline(in,line)) {
    line=trim(line);if(line.empty())continue;
    if(line[0]=='#') {
      auto equals=line.find('=');if(equals==std::string::npos)continue;
      auto name=trim(line.substr(1,equals-1)),value=trim(line.substr(equals+1));
      if(!metadata.emplace(name,value).second)throw std::invalid_argument("Duplicate tariff metadata");
      continue;
    }
    auto f=fields(line);
    if(!header) {
      if(f.size()<4||f.size()>35||f[0]!="road"||f[1]!="section"||f[2]!="km")throw std::invalid_argument("Unsupported tariff columns");
      for(std::size_t i=3;i<f.size();++i) {
        if(f[i].substr(0,5)!="class"||f[i].size()==5)throw std::invalid_argument("Invalid vehicle class column");
        auto suffix=f[i].substr(5);
        if(suffix[0]=='0'||!std::all_of(suffix.begin(),suffix.end(),[](unsigned char c){return std::isdigit(c);}))throw std::invalid_argument("Invalid vehicle class identifier");
        auto id=std::stoi(suffix);
        if(id<1||id>99||std::find(table.classes.begin(),table.classes.end(),id)!=table.classes.end())throw std::invalid_argument("Duplicate/invalid vehicle class");
        table.classes.push_back(id);
      }
      header=true;continue;
    }
    if(f.size()!=3+table.classes.size()||f[0].empty()||f[1].empty())throw std::invalid_argument("Invalid toll section");
    auto roadKey=key(f[0]);auto identity=roadKey+"\n"+f[1];
    if(!sections.insert(identity).second)throw std::invalid_argument("Duplicate toll section");
    auto km=number(f[2]);if(km<=0)throw std::invalid_argument("Invalid section length");
    auto &road=table.roadTotals_[roadKey];road.km+=km;
    std::unordered_map<int,double> prices;
    for(std::size_t i=0;i<table.classes.size();++i) {
      auto amount=number(f[3+i]);prices[table.classes[i]]=amount;road.prices[table.classes[i]]+=amount;
      if(!std::isfinite(road.prices[table.classes[i]]))throw std::invalid_argument("Tariff overflow");
    }
    table.sectionPrices_.emplace(identity,std::move(prices));
    if(!std::isfinite(road.km)||++rows>30000)throw std::invalid_argument("Tariff size/length overflow");
  }
  if(!header||!rows||metadata["country"]!=table.country)throw std::invalid_argument("Incomplete/cross-country tariff table");
  table.currency=metadata["currency"];table.year=metadata["year"];table.source=metadata["source"];table.version=metadata["version"];
  if(table.currency.size()!=3||!std::all_of(table.currency.begin(),table.currency.end(),[](unsigned char c){return c>='A'&&c<='Z';})||table.year.size()!=4||!std::all_of(table.year.begin(),table.year.end(),[](unsigned char c){return std::isdigit(c);})||table.source.substr(0,8)!="https://")throw std::invalid_argument("Invalid tariff provenance");
  if(metadata.count("scheme")&&metadata["scheme"]!="road-average")throw std::invalid_argument("Unsupported pricing scheme");
  if(metadata.count("fractionDigits")) {
    auto v=metadata["fractionDigits"];
    if(v.size()!=1||v[0]<'0'||v[0]>'3')throw std::invalid_argument("Invalid currency precision");
    table.fractionDigits=v[0]-'0';
  }
  if(!table.version.empty()&&(!std::all_of(table.version.begin(),table.version.end(),[](unsigned char c){return std::isdigit(c);})||table.version.size()>16))throw std::invalid_argument("Invalid tariff version");
  table.restrictEstimates_=metadata.count("estimateRoads");
  if(table.restrictEstimates_)for(auto ref:fields(metadata["estimateRoads"],',')) {
    auto k=key(ref);if(k.empty())continue;
    if(!table.roadTotals_.count(k))throw std::invalid_argument("Estimate policy refers to an absent road");
    table.estimateRoads_.insert(k);
  }
  return table;
}
std::optional<double> TollTariffs::estimate(std::string_view ref,double meters,int vehicleClass) const {
  if(!std::isfinite(meters)||meters<0||vehicleClass<1||vehicleClass>99)return std::nullopt;
  for(auto token:fields(std::string(ref),';'))for(auto comma:fields(token,','))for(auto road:fields(comma,'/')) {
    auto k=key(road);auto found=roadTotals_.find(k);
    if(found==roadTotals_.end())continue;
    if(restrictEstimates_&&!estimateRoads_.count(k))return std::nullopt;
    auto price=found->second.prices.find(vehicleClass);if(price==found->second.prices.end())return std::nullopt;
    auto amount=meters/1000.0*price->second/found->second.km;
    return std::isfinite(amount)&&amount<=1e12?std::optional<double>(amount):std::nullopt;
  }
  return std::nullopt;
}
std::optional<double> TollTariffs::sectionPrice(std::string_view road,std::string_view section,int vehicleClass) const {
  auto found=sectionPrices_.find(key(std::string(road))+"\n"+std::string(section));
  if(found==sectionPrices_.end())return std::nullopt;
  auto price=found->second.find(vehicleClass);
  return price==found->second.end()?std::nullopt:std::optional<double>(price->second);
}
} // namespace atlas
