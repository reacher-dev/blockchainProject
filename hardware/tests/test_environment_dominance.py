import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import web3_oracle


def test_prefers_environment_when_environment_dominates_recent_window():
    device_id = "test-env-dominant"
    now = int(time.time())

    web3_oracle.DEVICE_SOUND_HISTORY.clear()
    web3_oracle.DEVICE_SOUND_HISTORY[device_id] = [
        {"timestamp": now - 8, "sound_type": "environment_noise"},
        {"timestamp": now - 6, "sound_type": "environment_noise"},
        {"timestamp": now - 3, "sound_type": "human_created_noise"},
    ]

    result = web3_oracle.choose_sound_type_for_period(device_id, "human_created_noise", now)

    assert result == "environment_noise"


def test_keeps_human_noise_when_human_dominates_recent_window():
    device_id = "test-human-dominant"
    now = int(time.time())

    web3_oracle.DEVICE_SOUND_HISTORY.clear()
    web3_oracle.DEVICE_SOUND_HISTORY[device_id] = [
        {"timestamp": now - 8, "sound_type": "human_created_noise"},
        {"timestamp": now - 5, "sound_type": "human_created_noise"},
        {"timestamp": now - 2, "sound_type": "environment_noise"},
    ]

    result = web3_oracle.choose_sound_type_for_period(device_id, "human_created_noise", now)

    assert result == "human_created_noise"


def test_environment_override_raises_effective_confidence():
    device_id = "test-env-confidence"
    now = int(time.time())

    web3_oracle.DEVICE_SOUND_HISTORY.clear()
    web3_oracle.DEVICE_SOUND_HISTORY[device_id] = [
        {"timestamp": now - 8, "sound_type": "environment_noise"},
        {"timestamp": now - 6, "sound_type": "environment_noise"},
        {"timestamp": now - 3, "sound_type": "human_created_noise"},
    ]

    sound_type, confidence = web3_oracle.choose_sound_type_for_period(
        device_id,
        "human_created_noise",
        now,
        confidence=0.30,
    )

    assert sound_type == "environment_noise"
    assert confidence >= 0.60
