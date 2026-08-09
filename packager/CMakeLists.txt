cmake_minimum_required(VERSION 3.20)

project(
  roam_packager
  VERSION 0.1.0
  LANGUAGES CXX
)

set(CMAKE_CXX_STANDARD 20)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_CXX_EXTENSIONS OFF)

find_package(Boost REQUIRED)
find_package(nlohmann_json REQUIRED)
find_package(ZLIB REQUIRED)
find_package(BZip2 REQUIRED)
find_package(EXPAT REQUIRED)

find_path(
  OSMIUM_INCLUDE_DIR
  osmium/io/any_input.hpp
)

if(NOT OSMIUM_INCLUDE_DIR)
  message(FATAL_ERROR "libosmium headers not found")
endif()

add_executable(
  roam-packager
  src/main.cpp
  src/poi-extractor.cpp
  src/road-extractor.cpp
  src/routing-writer.cpp
  src/spatial-index.cpp
)

target_include_directories(
  roam-packager
  PRIVATE
    include
    ${OSMIUM_INCLUDE_DIR}
)

target_link_libraries(
  roam-packager
  PRIVATE
    Boost::boost
    nlohmann_json::nlohmann_json
    ZLIB::ZLIB
    BZip2::BZip2
    EXPAT::EXPAT
)

target_compile_options(
  roam-packager
  PRIVATE
    -Wall
    -Wextra
    -Wpedantic
)
