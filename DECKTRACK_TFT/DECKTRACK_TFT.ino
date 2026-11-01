// ==========================================================
// DECKTRACK - TFT dashboard (ESP32-S3 + 3.5" ILI9488)
// ==========================================================
// Reads the same Supabase tables as the website (items, borrows,
// students) and draws the dashboard on the TFT:
//   - Total / Available / Borrowed / Overdue counts
//   - The 5 most recent transactions
//
// Libraries (Arduino IDE -> Library Manager):
//   - TFT_eSPI      (by Bodmer)
//   - ArduinoJson   (by Benoit Blanchon, version 7.x)
// WiFi, WiFiClientSecure and HTTPClient come with the ESP32 board package.
//
// The TFT pins are NOT set in this file. They are set in the
// TFT_eSPI library's User_Setup.h (see the setup notes).
//
// Press the BOOT button on the board to refresh right away.
// ==========================================================

#include <WiFi.h>
#include <WiFiClientSecure.h>
#include <HTTPClient.h>
#include <ArduinoJson.h>
#include <TFT_eSPI.h>
#include <time.h>

// ---------- SETTINGS: change these ----------
const char* WIFI_SSID = "MorreWiFi";
const char* WIFI_PASS = "d6255587";

const char* SUPABASE_URL = "https://afnkvhshypzopwclerxy.supabase.co";
const char* SUPABASE_KEY = "sb_publishable_gj_OKhp5OuT96MqHWgMNqw_RP2L4QgW";

const unsigned long REFRESH_MS = 15000;   // auto refresh every 15 seconds
const long GMT_OFFSET_SEC = 8 * 3600;     // Philippines is UTC+8
const int BOOT_BUTTON = 0;                // BOOT button on most ESP32-S3 boards
// --------------------------------------------

#define RGB(r, g, b) ((((r) & 0xF8) << 8) | (((g) & 0xFC) << 3) | ((b) >> 3))

const uint16_t COL_BG     = RGB(244, 247, 252);
const uint16_t COL_NAVY   = RGB(20, 33, 61);
const uint16_t COL_BLUE   = RGB(50, 103, 233);
const uint16_t COL_CARD   = RGB(255, 255, 255);
const uint16_t COL_BORDER = RGB(230, 234, 241);
const uint16_t COL_TEXT   = RGB(32, 43, 60);
const uint16_t COL_MUTED  = RGB(123, 135, 153);
const uint16_t COL_GREEN  = RGB(21, 155, 101);
const uint16_t COL_GREEN_BG  = RGB(229, 247, 238);
const uint16_t COL_ORANGE = RGB(185, 121, 21);
const uint16_t COL_ORANGE_BG = RGB(255, 243, 223);
const uint16_t COL_RED    = RGB(217, 68, 68);
const uint16_t COL_RED_BG = RGB(255, 235, 235);

TFT_eSPI tft = TFT_eSPI();

struct Stats {
    int total = 0;
    int available = 0;
    int borrowed = 0;
    int overdue = 0;
};

struct Row {
    String borrower;
    String equipment;
    String status;   // "Borrowed", "Returned" or "Overdue"
};

Stats stats;
Row rows[5];
int rowCount = 0;
bool online = false;
unsigned long lastRefresh = 0;

// ---------- helpers ----------

String todayISO() {
    struct tm t;
    if (!getLocalTime(&t, 1000)) return "";
    char buf[11];
    strftime(buf, sizeof(buf), "%Y-%m-%d", &t);
    return String(buf);
}

String fit(const String& s, int maxChars) {
    if ((int)s.length() <= maxChars) return s;
    return s.substring(0, maxChars - 1) + ".";
}

void showMessage(const char* line1, const char* line2 = "") {
    tft.fillScreen(COL_BG);
    tft.setTextDatum(MC_DATUM);
    tft.setTextColor(COL_TEXT, COL_BG);
    tft.drawString(line1, 240, 150, 4);
    tft.setTextColor(COL_MUTED, COL_BG);
    tft.drawString(line2, 240, 185, 2);
}

// ---------- Supabase ----------

// Sends GET /rest/v1/<path> and parses the JSON answer into doc.
bool supabaseGet(const String& path, JsonDocument& doc) {
    if (WiFi.status() != WL_CONNECTED) return false;

    WiFiClientSecure client;
    client.setInsecure();   // skips the certificate check (fine for a prototype)

    HTTPClient http;
    http.setTimeout(10000);

    String url = String(SUPABASE_URL) + "/rest/v1/" + path;
    if (!http.begin(client, url)) return false;

    http.addHeader("apikey", SUPABASE_KEY);
    http.addHeader("Accept", "application/json");

    int code = http.GET();
    if (code != 200) {
        Serial.printf("GET %s -> HTTP %d\n", path.c_str(), code);
        if (code > 0) Serial.println(http.getString());
        http.end();
        return false;
    }

    String body = http.getString();
    http.end();

    DeserializationError err = deserializeJson(doc, body.c_str());
    if (err) {
        Serial.printf("JSON error: %s\n", err.c_str());
        return false;
    }
    return true;
}

bool loadStats(const String& today) {
    JsonDocument items;
    if (!supabaseGet("items?select=quantity,available", items)) return false;

    Stats s;
    for (JsonObject it : items.as<JsonArray>()) {
        s.total += it["quantity"] | 0;
        s.available += it["available"] | 0;
    }

    JsonDocument open;
    if (!supabaseGet("borrows?returned_at=is.null&select=quantity,due_date", open)) {
        return false;
    }

    for (JsonObject b : open.as<JsonArray>()) {
        int q = b["quantity"] | 1;
        s.borrowed += q;

        const char* due = b["due_date"] | "";
        if (today.length() && due[0] && strcmp(due, today.c_str()) < 0) {
            s.overdue += q;
        }
    }

    stats = s;
    return true;
}

bool loadRecent(const String& today) {
    JsonDocument doc;
    if (!supabaseGet(
            "borrows?select=quantity,returned_at,due_date,students(name),items(name)"
            "&order=id.desc&limit=5",
            doc)) {
        return false;
    }

    rowCount = 0;
    for (JsonObject b : doc.as<JsonArray>()) {
        if (rowCount >= 5) break;

        const char* who = b["students"]["name"] | "Unknown";
        const char* what = b["items"]["name"] | "Unknown";

        String status = "Borrowed";
        if (!b["returned_at"].isNull()) {
            status = "Returned";
        } else {
            const char* due = b["due_date"] | "";
            if (today.length() && due[0] && strcmp(due, today.c_str()) < 0) {
                status = "Overdue";
            }
        }

        rows[rowCount].borrower = String(who);
        rows[rowCount].equipment = String(what);
        rows[rowCount].status = status;
        rowCount++;
    }
    return true;
}

// ---------- drawing ----------

void drawHeader() {
    tft.fillRect(0, 0, 480, 40, COL_NAVY);

    tft.fillRoundRect(8, 6, 28, 28, 6, COL_BLUE);
    tft.setTextDatum(MC_DATUM);
    tft.setTextColor(TFT_WHITE, COL_BLUE);
    tft.drawString("D", 22, 20, 4);

    tft.setTextDatum(TL_DATUM);
    tft.setTextColor(TFT_WHITE, COL_NAVY);
    tft.drawString("DECKTRACK", 46, 7, 4);

    uint16_t dot = online ? COL_GREEN : COL_RED;
    tft.fillCircle(404, 20, 4, dot);
    tft.setTextDatum(TR_DATUM);
    tft.setTextColor(TFT_WHITE, COL_NAVY);
    tft.drawString(online ? "Online" : "Offline", 470, 12, 2);
}

void drawTile(int x, const char* label, int value, uint16_t color) {
    tft.fillRoundRect(x, 48, 112, 72, 8, COL_CARD);
    tft.drawRoundRect(x, 48, 112, 72, 8, COL_BORDER);

    tft.setTextDatum(TL_DATUM);
    tft.setTextColor(COL_MUTED, COL_CARD);
    tft.drawString(label, x + 10, 58, 2);

    tft.setTextColor(color, COL_CARD);
    tft.drawString(String(value), x + 10, 82, 4);
}

void drawRow(int index, const Row& r) {
    int y = 160 + index * 30;

    tft.setTextDatum(TL_DATUM);
    tft.setTextColor(COL_TEXT, COL_CARD);
    tft.drawString(fit(r.borrower, 15), 14, y + 7, 2);

    tft.setTextColor(COL_MUTED, COL_CARD);
    tft.drawString(fit(r.equipment, 19), 170, y + 7, 2);

    uint16_t fg = COL_ORANGE;
    uint16_t bg = COL_ORANGE_BG;
    if (r.status == "Returned") {
        fg = COL_GREEN;
        bg = COL_GREEN_BG;
    } else if (r.status == "Overdue") {
        fg = COL_RED;
        bg = COL_RED_BG;
    }

    tft.fillRoundRect(384, y + 4, 84, 22, 11, bg);
    tft.setTextDatum(MC_DATUM);
    tft.setTextColor(fg, bg);
    tft.drawString(r.status, 426, y + 15, 2);

    tft.drawFastHLine(10, y + 29, 460, COL_BORDER);
}

void drawDashboard() {
    tft.fillScreen(COL_BG);
    drawHeader();

    drawTile(4,   "Total",     stats.total,     COL_BLUE);
    drawTile(124, "Available", stats.available, COL_GREEN);
    drawTile(244, "Borrowed",  stats.borrowed,  COL_ORANGE);
    drawTile(364, "Overdue",   stats.overdue,   COL_RED);

    tft.fillRoundRect(4, 128, 472, 188, 8, COL_CARD);
    tft.drawRoundRect(4, 128, 472, 188, 8, COL_BORDER);

    tft.setTextDatum(TL_DATUM);
    tft.setTextColor(COL_TEXT, COL_CARD);
    tft.drawString("Recent Transactions", 14, 136, 2);

    if (rowCount == 0) {
        tft.setTextDatum(MC_DATUM);
        tft.setTextColor(COL_MUTED, COL_CARD);
        tft.drawString(online ? "No transactions yet." : "No data yet.", 240, 235, 2);
        return;
    }

    for (int i = 0; i < rowCount; i++) {
        drawRow(i, rows[i]);
    }
}

// ---------- main flow ----------

void refresh() {
    lastRefresh = millis();

    if (WiFi.status() != WL_CONNECTED) {
        WiFi.reconnect();
        delay(1500);
    }

    String today = todayISO();
    bool ok = loadStats(today) && loadRecent(today);

    online = ok;
    drawDashboard();   // keeps the last good numbers if the refresh failed
}

void setup() {
    Serial.begin(115200);
    pinMode(BOOT_BUTTON, INPUT_PULLUP);

    tft.init();
    tft.setRotation(1);   // landscape 480 x 320. Try 3 if the picture is upside down.

    showMessage("DECKTRACK", "Connecting to WiFi...");

    WiFi.mode(WIFI_STA);
    WiFi.begin(WIFI_SSID, WIFI_PASS);

    unsigned long start = millis();
    while (WiFi.status() != WL_CONNECTED && millis() - start < 20000) {
        delay(300);
    }

    if (WiFi.status() != WL_CONNECTED) {
        showMessage("WiFi failed", "Check the name and password, then press RESET.");
        // Keep going: refresh() will try to reconnect.
    } else {
        Serial.print("WiFi connected, IP: ");
        Serial.println(WiFi.localIP());

        configTime(GMT_OFFSET_SEC, 0, "pool.ntp.org", "time.google.com");
        showMessage("Connected", "Loading data...");
    }

    refresh();
}

void loop() {
    if (millis() - lastRefresh >= REFRESH_MS) {
        refresh();
    }

    if (digitalRead(BOOT_BUTTON) == LOW) {
        refresh();
        delay(400);   // simple debounce
    }

    delay(20);
}
