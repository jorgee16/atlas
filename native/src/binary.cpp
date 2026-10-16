#include "atlas/core.hpp"
#include <algorithm>
#include <cmath>
#include <cstring>
#include <fcntl.h>
#include <stdexcept>
#include <sys/mman.h>
#include <sys/stat.h>
#include <unistd.h>

namespace atlas {
Binary::Binary(const std::string &path) {
  int fd = open(path.c_str(), O_RDONLY | O_CLOEXEC);
  if (fd < 0)
    throw std::runtime_error("Cannot open installed asset: " + path);
  struct stat st{};
  if (fstat(fd, &st) || st.st_size <= 0 ||
      uint64_t(st.st_size) > std::numeric_limits<std::size_t>::max()) {
    close(fd);
    throw std::runtime_error("Empty or invalid binary asset: " + path);
  }
  size_ = std::size_t(st.st_size);
  void *map = mmap(nullptr, size_, PROT_READ, MAP_PRIVATE, fd, 0);
  close(fd);
  if (map == MAP_FAILED)
    throw std::runtime_error("Cannot map binary asset: " + path);
  data_ = static_cast<const uint8_t *>(map);
}
Binary::~Binary() {
  if (data_)
    munmap(const_cast<uint8_t *>(data_), size_);
}
void Binary::range(std::size_t o, std::size_t n) const {
  if (o > size_ || n > size_ - o)
    throw std::runtime_error("Truncated or out-of-range binary asset");
}
uint8_t Binary::u8(std::size_t o) const {
  range(o, 1);
  return data_[o];
}
uint16_t Binary::u16(std::size_t o) const {
  range(o, 2);
  return uint16_t(data_[o]) | uint16_t(data_[o + 1]) << 8;
}
uint32_t Binary::u32(std::size_t o) const {
  range(o, 4);
  return uint32_t(data_[o]) | uint32_t(data_[o + 1]) << 8 |
         uint32_t(data_[o + 2]) << 16 | uint32_t(data_[o + 3]) << 24;
}
int32_t Binary::i32(std::size_t o) const {
  auto v = u32(o);
  int32_t r;
  std::memcpy(&r, &v, 4);
  return r;
}
float Binary::f32(std::size_t o) const {
  auto v = u32(o);
  float r;
  std::memcpy(&r, &v, 4);
  return r;
}
std::string_view Binary::text(std::size_t o, std::size_t n) const {
  range(o, n);
  return {reinterpret_cast<const char *>(data_ + o), n};
}
void Binary::header(std::string_view magic, uint32_t version,
                    std::size_t minimum) const {
  range(0, minimum);
  if (text(0, 4) != magic || u32(4) != version)
    throw std::runtime_error("Unsupported binary signature or version: " +
                             std::string(magic));
}
bool valid(Point p) {
  return std::isfinite(p.lat) && std::isfinite(p.lon) &&
         std::abs(p.lat) <= 90 && std::abs(p.lon) <= 180;
}
double distance(Point a, Point b) {
  constexpr double rad = 3.14159265358979323846 / 180;
  double x = std::sin((b.lat - a.lat) * rad / 2),
         y = std::sin((b.lon - a.lon) * rad / 2);
  double h = std::clamp(
      x * x + std::cos(a.lat * rad) * std::cos(b.lat * rad) * y * y, 0., 1.);
  return 12742000 * std::atan2(std::sqrt(h), std::sqrt(1 - h));
}
double bearing(Point a, Point b) {
  constexpr double rad = 3.14159265358979323846 / 180;
  double y = std::sin((b.lon - a.lon) * rad) * std::cos(b.lat * rad);
  double x = std::cos(a.lat * rad) * std::sin(b.lat * rad) -
             std::sin(a.lat * rad) * std::cos(b.lat * rad) *
                 std::cos((b.lon - a.lon) * rad);
  return std::fmod(std::atan2(y, x) / rad + 360, 360);
}
std::string jsonString(std::string_view v) {
  std::string s = "\"";
  const char *hex = "0123456789abcdef";
  for (unsigned char c : v) {
    if (c == '"' || c == '\\') {
      s += '\\';
      s += char(c);
    } else if (c < 32) {
      s += "\\u00";
      s += hex[c >> 4];
      s += hex[c & 15];
    } else
      s += char(c);
  }
  return s + '"';
}
} // namespace atlas
