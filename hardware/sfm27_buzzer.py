from machine import Pin
from time import sleep

# Connect this pin to the transistor base/gate driver, not directly to 12V.
BUZZER_PIN = 15
ON_SECONDS = 0.2
OFF_SECONDS = 0.8

buzzer = Pin(BUZZER_PIN, Pin.OUT)

print("SFM-27-W buzzer test. Press Ctrl+C to stop.")

try:
    while True:
        buzzer.on()
        sleep(ON_SECONDS)
        buzzer.off()
        sleep(OFF_SECONDS)
except KeyboardInterrupt:
    buzzer.off()
    print("Finished.")
