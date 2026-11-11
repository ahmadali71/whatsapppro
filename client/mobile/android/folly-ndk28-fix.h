#pragma once
#ifdef __cplusplus
#include <__string/char_traits.h>

namespace std {
template <>
struct char_traits<unsigned char> {
  using char_type = unsigned char;
  using int_type = int;
  using off_type = streamoff;
  using pos_type = streampos;
  using state_type = mbstate_t;
#if _LIBCPP_STD_VER >= 20
  using comparison_category = strong_ordering;
#endif

  static inline constexpr void assign(char_type& c1, const char_type& c2) noexcept { c1 = c2; }
  static inline constexpr bool eq(char_type c1, char_type c2) noexcept { return c1 == c2; }
  static inline constexpr bool lt(char_type c1, char_type c2) noexcept { return c1 < c2; }

  static inline constexpr int compare(const char_type* s1, const char_type* s2, size_t n) noexcept {
    for (size_t i = 0; i < n; ++i) {
      if (s1[i] < s2[i]) return -1;
      if (s2[i] < s1[i]) return 1;
    }
    return 0;
  }
  static inline constexpr size_t length(const char_type* s) noexcept {
    size_t len = 0;
    while (s[len] != 0) ++len;
    return len;
  }
  static inline constexpr const char_type* find(const char_type* s, size_t n, const char_type& a) noexcept {
    for (size_t i = 0; i < n; ++i) {
      if (s[i] == a) return s + i;
    }
    return nullptr;
  }
  static inline constexpr char_type* move(char_type* s1, const char_type* s2, size_t n) noexcept {
    if (s1 < s2) {
      for (size_t i = 0; i < n; ++i) s1[i] = s2[i];
    } else if (s1 > s2) {
      for (size_t i = n; i > 0; --i) s1[i - 1] = s2[i - 1];
    }
    return s1;
  }
  static inline constexpr char_type* copy(char_type* s1, const char_type* s2, size_t n) noexcept {
    for (size_t i = 0; i < n; ++i) s1[i] = s2[i];
    return s1;
  }
  static inline constexpr char_type* assign(char_type* s, size_t n, char_type a) noexcept {
    for (size_t i = 0; i < n; ++i) s[i] = a;
    return s;
  }
  static inline constexpr int_type not_eof(int_type c) noexcept { return eq_int_type(c, eof()) ? 0 : c; }
  static inline constexpr char_type to_char_type(int_type c) noexcept { return static_cast<char_type>(c); }
  static inline constexpr int_type to_int_type(char_type c) noexcept { return static_cast<int_type>(c); }
  static inline constexpr bool eq_int_type(int_type c1, int_type c2) noexcept { return c1 == c2; }
  static inline constexpr int_type eof() noexcept { return -1; }
};
} // namespace std
#endif
