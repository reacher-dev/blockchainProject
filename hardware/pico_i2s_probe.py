import time
from machine import I2S, Pin


# Standalone MicroPython probe for Pico W + INMP441.
# It does not use Wi-Fi or the backend. The goal is to prove whether
# machine.I2S can read any non-zero bytes from the microphone data line.

SAMPLE_RATE = 16000
BUFFER_SIZE = 2048

# Put your expected wiring first. Other pairs are common Pico I2S layouts.
SCK_WS_CANDIDATES = (
    (10, 11),
    (11, 10),
)

SD_CANDIDATES = (12,)
BIT_DEPTHS = (32, 16)
FORMATS = (I2S.STEREO, I2S.MONO)


def read_signed_le(buffer, offset, byte_count):
    value = int.from_bytes(buffer[offset : offset + byte_count], "little")
    sign_bit = 1 << (byte_count * 8 - 1)
    full_scale = 1 << (byte_count * 8)
    if value & sign_bit:
        value -= full_scale
    return value


def buffer_stats(buffer, bytes_read, bits, stereo):
    byte_count = bits // 8
    frame_size = byte_count * (2 if stereo else 1)
    nonzero_bytes = 0
    for value in buffer[:bytes_read]:
        if value:
            nonzero_bytes += 1

    peak = 0
    left_peak = 0
    right_peak = 0
    if stereo:
        for offset in range(0, bytes_read - frame_size + 1, frame_size):
            left_abs = abs(read_signed_le(buffer, offset, byte_count))
            right_abs = abs(read_signed_le(buffer, offset + byte_count, byte_count))
            if left_abs > left_peak:
                left_peak = left_abs
            if right_abs > right_peak:
                right_peak = right_abs
        peak = left_peak if left_peak >= right_peak else right_peak
    else:
        for offset in range(0, bytes_read - byte_count + 1, byte_count):
            sample_abs = abs(read_signed_le(buffer, offset, byte_count))
            if sample_abs > peak:
                peak = sample_abs

    first_bytes = " ".join("{:02x}".format(b) for b in buffer[: min(bytes_read, 24)])
    return peak, left_peak, right_peak, nonzero_bytes, first_bytes


def quick_pin_state(pin_number):
    # This is only a rough line-state check before I2S starts.
    # If pull-up and pull-down both read different values, the line is likely floating.
    try:
        pin_up = Pin(pin_number, Pin.IN, Pin.PULL_UP)
        time.sleep_ms(5)
        up_value = pin_up.value()
        pin_down = Pin(pin_number, Pin.IN, Pin.PULL_DOWN)
        time.sleep_ms(5)
        down_value = pin_down.value()
        return up_value, down_value
    except Exception:
        return None, None


def probe_once(i2s_id, sck_pin, ws_pin, sd_pin, bits, audio_format):
    i2s = None
    stereo = audio_format == I2S.STEREO
    try:
        i2s = I2S(
            i2s_id,
            sck=Pin(sck_pin),
            ws=Pin(ws_pin),
            sd=Pin(sd_pin),
            mode=I2S.RX,
            bits=bits,
            format=audio_format,
            rate=SAMPLE_RATE,
            ibuf=BUFFER_SIZE * 2,
        )
        buffer = bytearray(BUFFER_SIZE)
        time.sleep_ms(150)
        bytes_read = 0
        for _ in range(6):
            bytes_read = i2s.readinto(buffer)
            time.sleep_ms(20)
        peak, left_peak, right_peak, nonzero_bytes, first_bytes = buffer_stats(
            buffer,
            bytes_read,
            bits,
            stereo,
        )
        print(
            "probe id={} sck=GP{} ws=GP{} sd=GP{} bits={} fmt={} bytes={} peak={} left={} right={} nonzero={} first={}".format(
                i2s_id,
                sck_pin,
                ws_pin,
                sd_pin,
                bits,
                "stereo" if stereo else "mono",
                bytes_read,
                peak,
                left_peak,
                right_peak,
                nonzero_bytes,
                first_bytes,
            )
        )
        return peak, nonzero_bytes
    except Exception as exc:
        print(
            "probe failed id={} sck=GP{} ws=GP{} sd=GP{} bits={} fmt={}: {}".format(
                i2s_id,
                sck_pin,
                ws_pin,
                sd_pin,
                bits,
                "stereo" if stereo else "mono",
                exc,
            )
        )
        return 0, 0
    finally:
        if i2s is not None:
            try:
                i2s.deinit()
            except Exception:
                pass


def main():
    print("Pico W INMP441 standalone I2S probe")
    print("Expected wiring first: SCK=GP10, WS=GP11, SD=GP12, L/R=GND")
    print("If every probe is zero, machine.I2S is not seeing the microphone data line.")

    for sd_pin in SD_CANDIDATES:
        up_value, down_value = quick_pin_state(sd_pin)
        print("sd_line GP{} pullup={} pulldown={}".format(sd_pin, up_value, down_value))

    best = None
    for sck_pin, ws_pin in SCK_WS_CANDIDATES:
        used_sds = []
        for sd_pin in SD_CANDIDATES:
            if sd_pin in (sck_pin, ws_pin) or sd_pin in used_sds:
                continue
            used_sds.append(sd_pin)
            for i2s_id in (0, 1):
                for bits in BIT_DEPTHS:
                    for audio_format in FORMATS:
                        peak, nonzero_bytes = probe_once(
                            i2s_id,
                            sck_pin,
                            ws_pin,
                            sd_pin,
                            bits,
                            audio_format,
                        )
                        if peak > 0 and nonzero_bytes > 0:
                            score = peak + nonzero_bytes
                            if best is None or score > best["score"]:
                                best = {
                                    "score": score,
                                    "i2s_id": i2s_id,
                                    "sck_pin": sck_pin,
                                    "ws_pin": ws_pin,
                                    "sd_pin": sd_pin,
                                    "bits": bits,
                                    "format": "stereo" if audio_format == I2S.STEREO else "mono",
                                    "peak": peak,
                                    "nonzero_bytes": nonzero_bytes,
                                }

    if best:
        print("BEST", best)
        print(
            "Use: INMP441_I2S_ID={}, INMP441_SCK_PIN={}, INMP441_WS_PIN={}, INMP441_SD_PIN={}".format(
                best["i2s_id"],
                best["sck_pin"],
                best["ws_pin"],
                best["sd_pin"],
            )
        )
    else:
        print("NO_SIGNAL_FOUND")
        print("This rules out backend/model code. Try a different MicroPython firmware or test the same mic with Arduino/CircuitPython.")


main()
