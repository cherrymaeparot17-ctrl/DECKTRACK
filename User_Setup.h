// ==========================================================
// User_Setup.h for DECKTRACK
// 2.8" ST7789 TFT (240 x 320) on an ESP32-S3
// ==========================================================
// Where it goes:
//   Documents\Arduino\libraries\TFT_eSPI\User_Setup.h
// (Rename the original to User_Setup_backup.h first, then copy this file in.)
//
// IMPORTANT: the pin numbers below are EXAMPLES.
// Change them to the ESP32-S3 pins your TFT is really wired to.
// ==========================================================

// ----- Display driver -----
#define ST7789_DRIVER

// ----- Screen size (the panel's native, upright size) -----
#define TFT_WIDTH  240
#define TFT_HEIGHT 320

// ----- Pins (ESP32-S3) -----
#define TFT_MISO -1   // ST7789 modules usually have no MISO/SDO pin. Leave -1.
#define TFT_MOSI 11   // module pin: SDA / SDI / MOSI
#define TFT_SCLK 12   // module pin: SCL / SCK
#define TFT_CS   10   // module pin: CS. Use -1 if your module has no CS pin (tied to GND)
#define TFT_DC    9   // module pin: DC / RS
#define TFT_RST   8   // module pin: RES / RST. Use -1 if it is tied to the ESP32's RST or 3.3V

// Backlight (BL / LED pin). If it is wired straight to 3.3V, leave these out.
// If you wired it to a GPIO, uncomment and set the pin:
// #define TFT_BL   7
// #define TFT_BACKLIGHT_ON HIGH

// ----- Fonts used by the DECKTRACK sketch -----
#define LOAD_GLCD   // Font 1 (small 6x8 font) - used for small labels
#define LOAD_FONT2  // Font 2 (16 px)          - used for most text
#define LOAD_FONT4  // Font 4 (26 px)          - used for the title and big numbers

// ----- Speed -----
#define SPI_FREQUENCY  40000000

// ----- Only if the picture looks wrong (try ONE at a time) -----
// Red and blue are swapped:
// #define TFT_RGB_ORDER TFT_BGR
// Colors look inverted (white screen turns black, etc.):
// #define TFT_INVERSION_ON
// If it was already inverted and got worse, use this one instead:
// #define TFT_INVERSION_OFF