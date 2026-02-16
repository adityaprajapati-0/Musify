import numpy as np
import soundfile as sf
import os

test_file = "test_sf.wav"
try:
    # Create a 1-second sine wave
    data = np.random.uniform(-1, 1, 16000).astype(np.float32)
    sf.write(test_file, data, 16000)
    print("Successfully wrote test WAV.")
    
    # Read it back
    data_back, sr = sf.read(test_file)
    print(f"Successfully read back test WAV. SR: {sr}, Samples: {len(data_back)}")
    
    os.remove(test_file)
except Exception as e:
    print(f"FAILED to use soundfile: {e}")
