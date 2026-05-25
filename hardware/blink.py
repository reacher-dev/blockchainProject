from machine import Pin
from time import sleep

# Use "LED" for the Pico W built-in LED.
# Use a GPIO number, such as 15, for an external LED connected to GP15.
LED_PIN = 15
BLINK_DELAY_SECONDS = 0.1

led = Pin(LED_PIN, Pin.OUT)

print("LED starts blinking. Press Ctrl+C to stop.")

try:
    while True:
        led.on()
        sleep(BLINK_DELAY_SECONDS)
        led.off()
        sleep(BLINK_DELAY_SECONDS)
except KeyboardInterrupt:
    led.off()
    print("Finished.")
