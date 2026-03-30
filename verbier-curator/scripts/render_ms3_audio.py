import os
import sys
import glob
import subprocess
import shutil

# Paths
BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ASSETS_DIR = os.path.join(BASE_DIR, "assets")
AUDIO_DIR = os.path.join(ASSETS_DIR, "audio")
STEMS_DIR = os.path.join(ASSETS_DIR, "stems")
TMP_DIR = os.path.join(ASSETS_DIR, "tmp_musescore")
REPO_DIR = os.path.join(TMP_DIR, "mozart_string_quartets")
MSCORE_BIN = "/Applications/MuseScore 4.app/Contents/MacOS/mscore"

os.makedirs(AUDIO_DIR, exist_ok=True)
os.makedirs(STEMS_DIR, exist_ok=True)
os.makedirs(TMP_DIR, exist_ok=True)

def clone_repo():
    if not os.path.exists(REPO_DIR):
        print("Cloning DCML mendelssohn_quartets repository...")
        subprocess.run(["git", "clone", "https://github.com/DCMLab/mendelssohn_quartets.git", REPO_DIR], check=True)

def render_score(name, mscz_path):
    print(f"\n--- Processing {name} ({os.path.basename(mscz_path)}) ---")
    
    # 2. Extract Parts
    print("Splitting into parts using MuseScore 4...")
    # --score-parts generates separate .mscz files for each part in the SAME directory as the source
    subprocess.run([MSCORE_BIN, "--score-parts", mscz_path], check=True)
    
    # The generated parts usually have names like Op12-01-Violin_1.mscz next to the original file
    source_dir = os.path.dirname(mscz_path)
    part_files = [f for f in glob.glob(os.path.join(source_dir, "*.mscz")) if f != mscz_path]
    print(f"Found {len(part_files)} parts.")
    
    stem_files = []
    for part_f in part_files:
        base = os.path.basename(part_f).replace(".mscz", "")
        # Normalize name for our stems convention
        clean_part = base.split("-")[-1].lower().replace(" ", "")
        wav_out = os.path.join(TMP_DIR, f"{name}_{clean_part}.wav")
        ogg_out = os.path.join(STEMS_DIR, f"{name}_{clean_part}.ogg")
        
        print(f"  Rendering {clean_part} to WAV...")
        subprocess.run([MSCORE_BIN, "-o", wav_out, part_f], check=True)
        
        print(f"  Converting {clean_part} to OGG...")
        subprocess.run(["ffmpeg", "-y", "-i", wav_out, "-af", "loudnorm,silenceremove=start_periods=1:start_duration=0:start_threshold=-60dB", "-c:a", "libvorbis", "-q:a", "4", ogg_out], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        stem_files.append(ogg_out)
        
    # 4. Render Master Mix
    print(f"Rendering master mix for {name}...")
    wav_mix = os.path.join(TMP_DIR, f"{name}_mix.wav")
    ogg_mix = os.path.join(AUDIO_DIR, f"{name}_mix.ogg")
    subprocess.run([MSCORE_BIN, "-o", wav_mix, mscz_path], check=True)
    subprocess.run(["ffmpeg", "-y", "-i", wav_mix, "-af", "loudnorm=I=-16:TP=-1.5:LRA=11", "-c:a", "libvorbis", "-q:a", "5", ogg_mix], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    
    return True

def main():
    print("Starting MS3/MuseScore stems rendering...")
    # Clean previous repo if any
    if os.path.exists(REPO_DIR):
        shutil.rmtree(REPO_DIR)
        
    clone_repo()
    
    # Dynamically find the first 3 .mscx files
    all_scores = sorted(glob.glob(os.path.join(REPO_DIR, "**", "*.mscx"), recursive=True))
    targets = all_scores[:3]
    
    for filepath in targets:
        name = "dcml_" + os.path.basename(filepath).split(".")[0].lower()
        render_score(name, filepath)
        
    shutil.rmtree(TMP_DIR, ignore_errors=True)
    print("\n✅ Rendering complete. Now re-run `python3 scripts/extract_features.py` and `python3 scripts/build_manifest.py`.")

if __name__ == "__main__":
    main()
