#include "atlas/core.hpp"
#include <iostream>
int main(int argc, char **argv) {
  try {
    if (argc < 5) {
      std::cerr << "Usage: atlas_search DIRECTORY QUERY LAT LON [address]\n";
      return 2;
    }
    bool address = argc > 5 && std::string(argv[5]) == "address";
    auto base = std::string(argv[1]);
    atlas::Search search(
        base + (address ? "/address-index.bin" : "/search-index.bin"),
        base + (address ? "/address-records.bin" : "/search-records.bin"));
    auto anchor = atlas::Point{std::stod(argv[3]), std::stod(argv[4])};
    std::cout << atlas::placesJson(address
                                       ? search.addresses(argv[2], anchor, 12)
                                       : search.query(argv[2], anchor, 12))
              << '\n';
    return 0;
  } catch (const std::exception &e) {
    std::cerr << e.what() << '\n';
    return 1;
  }
}
