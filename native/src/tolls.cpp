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
  std::unordered_map<std::string,std::unordered_map<int,double>> rawPrices;
  std::istringstream in{std::string(csv)};std::string line;bool header=false;bool fixed=false,ticket=false;unsigned rows=0;
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
      if(f.size()<4||f.size()>35)throw std::invalid_argument("Unsupported tariff columns");
      fixed=f[0]=="charge"&&f[1]=="road"&&f[2]=="name";
      ticket=f[0]=="network"&&f[1]=="entry"&&f[2]=="exit";
      if(!fixed && !ticket && !(f[0]=="road"&&f[1]=="section"&&f[2]=="km"))throw std::invalid_argument("Unsupported tariff columns");
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
    if(ticket) {
      for(std::size_t i=0;i<3;++i)if(f[i].empty()||f[i].size()>128||!std::all_of(f[i].begin(),f[i].end(),[](unsigned char c){return (c>='A'&&c<='Z')||(c>='a'&&c<='z')||(c>='0'&&c<='9')||c=='_'||c=='-';}))throw std::invalid_argument("Invalid entry/exit identity");
      const auto identity=f[0]+"\n"+f[1]+"\n"+f[2];
      if(!sections.insert(identity).second)throw std::invalid_argument("Duplicate directed entry/exit fare");
      for(std::size_t i=0;i<table.classes.size();++i)rawPrices[identity][table.classes[i]]=number(f[3+i]);
      if(++rows>30000)throw std::invalid_argument("Tariff size overflow");
      continue;
    }
    if(fixed) {
      if(f[2].empty()||f[0].size()>128||!std::all_of(f[0].begin(),f[0].end(),[](unsigned char c){return std::isalnum(c)||c==':'||c=='-'||c=='_';}))throw std::invalid_argument("Invalid charge identity");
      if(!sections.insert(f[0]).second)throw std::invalid_argument("Duplicate fixed charge");
      // Delay conversion until currency precision metadata has been validated below.
      for(std::size_t i=0;i<table.classes.size();++i)number(f[3+i]);
      table.fixedChargeInfo_[f[0]]={f[0],f[1],f[2]};
      auto &raw=rawPrices[f[0]];
      for(std::size_t i=0;i<table.classes.size();++i)raw[table.classes[i]]=number(f[3+i]);
      if(++rows>30000)throw std::invalid_argument("Tariff size overflow");
      continue;
    }
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
  if(metadata.count("status")&&metadata["status"]!="active")throw std::invalid_argument("Unapproved tariff candidate");
  table.scheme=ticket?"entry-exit":fixed?"fixed-crossing":"road-average";
  if((metadata.count("scheme") && metadata["scheme"]!=table.scheme) || ((fixed||ticket)&&!metadata.count("scheme")))throw std::invalid_argument("Unsupported/mismatched pricing scheme");
  if(metadata.count("fractionDigits")) {
    auto v=metadata["fractionDigits"];
    if(v.size()!=1||v[0]<'0'||v[0]>'3')throw std::invalid_argument("Invalid currency precision");
    table.fractionDigits=v[0]-'0';
  }
  if(!table.version.empty()&&(!std::all_of(table.version.begin(),table.version.end(),[](unsigned char c){return std::isdigit(c);})||table.version.size()>16))throw std::invalid_argument("Invalid tariff version");
  if(fixed||ticket) {
    if(metadata.count("estimateRoads"))throw std::invalid_argument("Road-average policy in event-price catalog");
    const auto scale=std::pow(10.0,table.fractionDigits);
    for(const auto &charge:rawPrices)for(const auto &price:charge.second) {
      const auto scaled=price.second*scale;
      if(std::abs(scaled-std::round(scaled))>0.0001)throw std::invalid_argument("Price exceeds currency precision");
      auto &prices=ticket?table.entryExitFares_:table.fixedCharges_;
      prices[charge.first][price.first]=int64_t(std::llround(scaled));
    }
  }
  if(metadata.count("freeRoads")) {
    if(fixed || ticket || metadata["freeRoadSource"].substr(0,8)!="https://")throw std::invalid_argument("Missing explicit free-road provenance");
    table.freeRoadSource=metadata["freeRoadSource"];
    for(const auto &ref:fields(metadata["freeRoads"],',')) {
      const auto normalized=key(ref);
      if(normalized.empty()||!std::isalpha(static_cast<unsigned char>(normalized[0]))||normalized.size()>32||!std::all_of(normalized.begin(),normalized.end(),[](unsigned char c){return std::isalnum(c)||c=='-';})||!table.freeRoads_.insert(normalized).second)
        throw std::invalid_argument("Invalid/duplicate explicitly free road");
    }
  } else if(metadata.count("freeRoadSource"))throw std::invalid_argument("Free-road source without policy");
  table.restrictEstimates_=metadata.count("estimateRoads");
  if(table.restrictEstimates_)for(auto ref:fields(metadata["estimateRoads"],',')) {
    auto k=key(ref);if(k.empty())continue;
    if(!table.roadTotals_.count(k))throw std::invalid_argument("Estimate policy refers to an absent road");
    table.estimateRoads_.insert(k);
  }
  return table;
}
std::optional<double> TollTariffs::estimate(std::string_view ref,double meters,int vehicleClass) const {
  if(scheme!="road-average"||!std::isfinite(meters)||meters<0||vehicleClass<1||vehicleClass>99)return std::nullopt;
  bool free=false,paid=false;
  for(auto token:fields(std::string(ref),';'))for(auto comma:fields(token,','))for(auto road:fields(comma,'/')) {
    auto k=key(road);free=free||freeRoads_.count(k);paid=paid||(roadTotals_.count(k)&&!freeRoads_.count(k));
  }
  if(free&&paid)return std::nullopt;
  if(free)return std::find(classes.begin(),classes.end(),vehicleClass)!=classes.end()?std::optional<double>(0.):std::nullopt;
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
bool TollTariffs::explicitlyFree(std::string_view ref,int vehicleClass) const {
  if(scheme!="road-average"||std::find(classes.begin(),classes.end(),vehicleClass)==classes.end())return false;
  bool free=false;
  for(auto token:fields(std::string(ref),';'))for(auto comma:fields(token,','))for(auto road:fields(comma,'/')) {
    const auto k=key(road);
    if(roadTotals_.count(k)&&!freeRoads_.count(k))return false;
    free=free||freeRoads_.count(k);
  }
  return free;
}
std::optional<double> TollTariffs::sectionPrice(std::string_view road,std::string_view section,int vehicleClass) const {
  auto found=sectionPrices_.find(key(std::string(road))+"\n"+std::string(section));
  if(found==sectionPrices_.end())return std::nullopt;
  auto price=found->second.find(vehicleClass);
  return price==found->second.end()?std::nullopt:std::optional<double>(price->second);
}
std::optional<double> TollTariffs::fixedCharge(std::string_view chargeId,int vehicleClass) const {
  if(scheme!="fixed-crossing")return std::nullopt;
  const auto charge=fixedCharges_.find(std::string(chargeId));if(charge==fixedCharges_.end())return std::nullopt;
  const auto price=charge->second.find(vehicleClass);if(price==charge->second.end())return std::nullopt;
  return price->second/std::pow(10.0,fractionDigits);
}
std::optional<TollFixedChargeInfo> TollTariffs::fixedChargeInfo(std::string_view chargeId) const {
  const auto found=fixedChargeInfo_.find(std::string(chargeId));
  return found==fixedChargeInfo_.end()?std::nullopt:std::optional<TollFixedChargeInfo>(found->second);
}
std::optional<double> TollTariffs::sumFixedCharges(const std::vector<std::string> &crossings,int vehicleClass) const {
  if(scheme!="fixed-crossing"||std::find(classes.begin(),classes.end(),vehicleClass)==classes.end())return std::nullopt;
  int64_t total=0;
  for(const auto &id:crossings) {
    const auto charge=fixedCharges_.find(id);if(charge==fixedCharges_.end())return std::nullopt;
    const auto price=charge->second.find(vehicleClass);if(price==charge->second.end())return std::nullopt;
    if(total>std::numeric_limits<int64_t>::max()-price->second)return std::nullopt;
    total+=price->second;
  }
  return total/std::pow(10.0,fractionDigits);
}
std::optional<double> TollTariffs::entryExitFare(const TollJourney &journey,int vehicleClass) const {
  return sumEntryExitFares({journey},vehicleClass);
}
std::optional<double> TollTariffs::sumEntryExitFares(const std::vector<TollJourney> &journeys,int vehicleClass) const {
  if(scheme!="entry-exit"||std::find(classes.begin(),classes.end(),vehicleClass)==classes.end())return std::nullopt;
  int64_t total=0;
  for(const auto &journey:journeys) {
    const auto it=entryExitFares_.find(journey.network+"\n"+journey.entry+"\n"+journey.exit);
    if(it==entryExitFares_.end())return std::nullopt;
    const auto price=it->second.find(vehicleClass);
    if(price==it->second.end()||total>std::numeric_limits<int64_t>::max()-price->second)return std::nullopt;
    total+=price->second;
  }
  return total/std::pow(10.0,fractionDigits);
}
} // namespace atlas
