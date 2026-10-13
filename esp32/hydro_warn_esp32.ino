/**
 * =========================================================================
 * HydroWarn - ESP32 Fire Alarm & Sensor Monitoring System
 * =========================================================================
 * Deskripsi:
 * - Membaca sensor suhu & kelembaban (DHT22 dengan fallback DHT11).
 * - Relay fisik AKTIF TERUS selama suhu >= 33.0 °C ATAU kelembaban >= 70.0 %.
 * - Relay fisik MATI jika kondisi kembali normal.
 * - Mengirim HTTP POST HANYA SEKALI saat transisi state (Aman -> Bahaya atau Bahaya -> Aman).
 * =========================================================================
 */

#include <WiFi.h>
#include <HTTPClient.h>
#include <WiFiClientSecure.h>
#include "DHT.h"

// -------------------------------------------------------------------------
// 1. Konfigurasi WiFi
// -------------------------------------------------------------------------
const char* ssid     = "josjis";      // SSID WiFi
const char* password = "12345678";    // Password WiFi

// -------------------------------------------------------------------------
// 2. Konfigurasi Endpoint Server
// -------------------------------------------------------------------------
const char* serverUrl = "https://hydro-warn.vercel.app/api/sensor";

// -------------------------------------------------------------------------
// 3. Konfigurasi Pin Hardware
// -------------------------------------------------------------------------
#define DHT11_PIN  4      // Pin Data DHT11
#define DHT22_PIN  5      // Pin Data DHT22
#define RELAY_PIN  18     // Pin Kendali Relay

#define DHT11_TYPE DHT11
#define DHT22_TYPE DHT22

DHT dht11(DHT11_PIN, DHT11_TYPE);
DHT dht22(DHT22_PIN, DHT22_TYPE);

// -------------------------------------------------------------------------
// 4. Parameter Ambang Batas (Threshold) & Konfigurasi Relay
// -------------------------------------------------------------------------
const float AMBANG_SUHU_TRIGGER   = 33.0; // Suhu >= 33.0 °C
const float AMBANG_LEMBAP_TRIGGER = 70.0; // Kelembapan >= 70.0 %

// Modul relay umumnya Aktif LOW
#define RELAY_ON   LOW
#define RELAY_OFF  HIGH

// -------------------------------------------------------------------------
// 5. Timer Non-Blocking & State Tracking
// -------------------------------------------------------------------------
unsigned long previousMillis = 0;
const unsigned long intervalBacaSensor = 2500; // Cek sensor tiap 2.5 detik agar responsif

// Flag status untuk mendeteksi perubahan kondisi (Edge Detection)
bool statusBahayaSebelumnya = false;

// -------------------------------------------------------------------------
// Fungsi: Koneksi WiFi
// -------------------------------------------------------------------------
void hubungkanWiFi() {
  if (WiFi.status() == WL_CONNECTED) return;

  Serial.println("[WiFi] Menghubungkan ke: " + String(ssid));
  WiFi.mode(WIFI_STA);
  WiFi.begin(ssid, password);

  unsigned long startAttempt = millis();
  while (WiFi.status() != WL_CONNECTED && millis() - startAttempt < 10000) {
    delay(500);
    Serial.print(".");
  }

  if (WiFi.status() == WL_CONNECTED) {
    Serial.println("\n[WiFi] Terhubung! IP: " + WiFi.localIP().toString());
  } else {
    Serial.println("\n[WiFi] Gagal terhubung. Akan dicoba kembali nanti.");
  }
}

// -------------------------------------------------------------------------
// Fungsi: Kirim Payload JSON ke Endpoint
// -------------------------------------------------------------------------
void kirimDataJson(float suhu, float hum, bool relayState) {
  if (WiFi.status() != WL_CONNECTED) {
    Serial.println("[HTTP] Batal kirim: WiFi belum terhubung.");
    return;
  }

  WiFiClientSecure client;
  client.setInsecure();
  client.setTimeout(10);

  HTTPClient http;
  if (!http.begin(client, serverUrl)) {
    Serial.println("[HTTP] Inisialisasi HTTPClient gagal.");
    return;
  }

  http.setTimeout(10000);
  http.addHeader("Content-Type", "application/json");

  String payload = "{\"suhu\":" + String(suhu, 1) + 
                   ",\"humidity\":" + String(hum, 1) + 
                   ",\"relay\":" + (relayState ? "true" : "false") + "}";

  Serial.println("\n[HTTP] >>> Mengirim event perubahan state ke server...");
  Serial.println("[HTTP] Endpoint : " + String(serverUrl));
  Serial.println("[HTTP] Payload  : " + payload);

  int httpResponseCode = http.POST(payload);

  if (httpResponseCode > 0) {
    Serial.print("[HTTP] Response Code: ");
    Serial.println(httpResponseCode);
    String response = http.getString();
    Serial.println("[HTTP] Response Body: " + response);
  } else {
    Serial.print("[HTTP] Error kirim POST: ");
    Serial.println(http.errorToString(httpResponseCode));
  }

  http.end();
  client.stop();
}

// -------------------------------------------------------------------------
// Setup Utama
// -------------------------------------------------------------------------
void setup() {
  Serial.begin(115200);
  delay(1000);

  Serial.println("\n=======================================================");
  Serial.println("  HydroWarn - ESP32 State-Triggered Alert              ");
  Serial.println("  Logika: Kirim data HANYA SEKALI saat status berubah  ");
  Serial.println("=======================================================");

  pinMode(RELAY_PIN, OUTPUT);
  digitalWrite(RELAY_PIN, RELAY_OFF);

  dht11.begin();
  dht22.begin();

  hubungkanWiFi();
}

// -------------------------------------------------------------------------
// Loop Utama
// -------------------------------------------------------------------------
void loop() {
  if (WiFi.status() != WL_CONNECTED) {
    hubungkanWiFi();
  }

  unsigned long currentMillis = millis();

  // Pembacaan sensor periodik
  if (currentMillis - previousMillis >= intervalBacaSensor) {
    previousMillis = currentMillis;

    float suhu11 = dht11.readTemperature();
    float hum11  = dht11.readHumidity();

    float suhu22 = dht22.readTemperature();
    float hum22  = dht22.readHumidity();

    bool dht11_error = isnan(suhu11) || isnan(hum11);
    bool dht22_error = isnan(suhu22) || isnan(hum22);

    float suhuAcuan = NAN;
    float humAcuan  = NAN;
    String sumberSensor = "None";

    if (!dht22_error) {
      suhuAcuan = suhu22;
      humAcuan  = hum22;
      sumberSensor = "DHT22";
    } else if (!dht11_error) {
      suhuAcuan = suhu11;
      humAcuan  = hum11;
      sumberSensor = "DHT11 (Fallback)";
    }

    if (!isnan(suhuAcuan) && !isnan(humAcuan)) {
      // Evaluasi apakah kondisi saat ini masuk zona bahaya
      bool kondisiBahayaSekarang = (suhuAcuan >= AMBANG_SUHU_TRIGGER || humAcuan >= AMBANG_LEMBAP_TRIGGER);

      // Terapkan output relay fisik secara langsung
      if (kondisiBahayaSekarang) {
        digitalWrite(RELAY_PIN, RELAY_ON);
      } else {
        digitalWrite(RELAY_PIN, RELAY_OFF);
      }

      // --- LOGIKA EVENT: Hanya eksekusi jika terjadi PERUBAHAN STATUS ---
      if (kondisiBahayaSekarang != statusBahayaSebelumnya) {
        if (kondisiBahayaSekarang) {
          Serial.println("\n[EVENT] 🚨 Transisi: NORMAL -> BAHAYA! Relay ON. Kirim HTTP 1x.");
          kirimDataJson(suhuAcuan, humAcuan, true);
        } else {
          Serial.println("\n[EVENT] 🛡️ Transisi: BAHAYA -> NORMAL! Relay OFF. Kirim HTTP 1x.");
          kirimDataJson(suhuAcuan, humAcuan, false);
        }

        // Simpan status baru
        statusBahayaSebelumnya = kondisiBahayaSekarang;
      } else {
        // Status masih sama, tidak kirim HTTP (hemat bandwidth & tidak spam notif)
        Serial.print("[IDLE] Status: ");
        Serial.print(kondisiBahayaSekarang ? "BAHAYA (Relay ON)" : "AMAN (Relay OFF)");
        Serial.print(" | Suhu: ");
        Serial.print(suhuAcuan, 1);
        Serial.print(" C | Hum: ");
        Serial.print(humAcuan, 1);
        Serial.println(" %");
      }

    } else {
      Serial.println("[ERROR] Sensor gagal dibaca!");
      // Failsafe: Jika sensor putus saat kondisi bahaya sebelumnya aktif, matikan relay
      if (statusBahayaSebelumnya) {
        digitalWrite(RELAY_PIN, RELAY_OFF);
        statusBahayaSebelumnya = false;
        Serial.println("[FAILSAFE] Sensor error, relay dimatikan.");
      }
    }
  }
}
