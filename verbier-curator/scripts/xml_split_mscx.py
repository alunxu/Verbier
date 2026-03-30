import os
import sys
import glob
import subprocess
import shutil
import xml.etree.ElementTree as ET

# Paths
BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ASSETS_DIR = os.path.join(BASE_DIR, "assets")
AUDIO_DIR = os.path.join(ASSETS_DIR, "audio")
STEMS_DIR = os.path.join(ASSETS_DIR, "stems")
TMP_DIR = os.path.join(ASSETS_DIR, "tmp_musescore")
REPO_DIR = os.path.join(TMP_DIR, "mendelssohn_quartets")
MSCORE_BIN = "/Applications/MuseScore 4.app/Contents/MacOS/mscore"

os.makedirs(AUDIO_DIR, exist_ok=True)
os.makedirs(STEMS_DIR, exist_ok=True)
os.makedirs(TMP_DIR, exist_ok=True)

def clone_repo():
    if not os.path.exists(REPO_DIR):
        print("Cloning DCML mendelssohn_quartets repository...")
        subprocess.run(["git", "clone", "https://github.com/DCMLab/mendelssohn_quartets.git", REPO_DIR], check=True)

def isolate_and_render_part(tree, mscx_path, staff_id, part_name, name_prefix):
    new_tree = ET.parse(mscx_path)
    root = new_tree.getroot()
    score = root.find("Score")
    
    # Non-destructive method: mute all other parts by setting their MIDI volume (CC7) to 0
    parts = score.findall("Part")
    for p in parts:
        staff_el = p.find("Staff")
        current_id = staff_el.attrib.get("id") if staff_el is not None else None
        
        if current_id != staff_id:
            # Mute this part
            for instr in p.findall("Instrument"):
                for channel in instr.findall("Channel"):
                    # Add <controller ctrl="7" value="0"/>
                    mute_ctrl = ET.Element("controller", ctrl="7", value="0")
                    channel.append(mute_ctrl)
    
    # Save isolated MSCX
    clean_name = part_name.lower().replace(" ", "").replace(".", "")
    if "violini" in clean_name and "ii" not in clean_name: clean_name = "violin1"
    if "violinii" in clean_name: clean_name = "violin2"
    
    isolated_mscx_path = os.path.join(TMP_DIR, f"isolated_{staff_id}.mscx")
    new_tree.write(isolated_mscx_path, encoding="UTF-8", xml_declaration=True)
    
    # Render stem
    wav_out = os.path.join(TMP_DIR, f"{name_prefix}_{clean_name}.wav")
    ogg_out = os.path.join(STEMS_DIR, f"{name_prefix}_{clean_name}.ogg")
    
    print(f"  Rendering part {staff_id} ({clean_name}) to WAV...")
    subprocess.run([MSCORE_BIN, "-o", wav_out, isolated_mscx_path], check=True)
    
    print(f"  Converting to OGG...")
    subprocess.run(["ffmpeg", "-y", "-i", wav_out, "-af", "loudnorm,silenceremove=start_periods=1:start_duration=0:start_threshold=-60dB", "-c:a", "libvorbis", "-q:a", "4", ogg_out], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    return ogg_out

def render_score(name, mscz_path):
    print(f"\n--- Processing {name} ({os.path.basename(mscz_path)}) ---")
    
    tree = ET.parse(mscz_path)
    root = tree.getroot()
    score = root.find("Score")
    parts = score.findall("Part")
    
    print(f"File contains {len(parts)} parts.")
    
    # Render Master Mix
    print(f"Rendering master mix for {name}...")
    wav_mix = os.path.join(TMP_DIR, f"{name}_mix.wav")
    ogg_mix = os.path.join(AUDIO_DIR, f"{name}_mix.ogg")
    subprocess.run([MSCORE_BIN, "-o", wav_mix, mscz_path], check=True)
    subprocess.run(["ffmpeg", "-y", "-i", wav_mix, "-af", "loudnorm=I=-16:TP=-1.5:LRA=11", "-c:a", "libvorbis", "-q:a", "5", ogg_mix], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    
    # Process each part
    for idx, part in enumerate(parts):
        staff = part.find("Staff")
        if staff is None: continue
        staff_id = staff.attrib.get("id")
        
        # Determine name
        part_name = f"part{idx}"
        instr = part.find("Instrument")
        if instr is not None:
            long_name = instr.find("longName")
            if long_name is not None and long_name.text:
                part_name = long_name.text
            else:
                track_name = instr.find("trackName")
                if track_name is not None and track_name.text:
                    part_name = track_name.text
        
        isolate_and_render_part(tree, mscz_path, staff_id, part_name, name)
        
    return True

def main():
    print("Starting custom XML stems rendering (bypassing ms3 limitaitons)...")
    if os.path.exists(REPO_DIR):
        shutil.rmtree(REPO_DIR)
        
    clone_repo()
    
    # Find the top 3 scores
    all_scores = sorted(glob.glob(os.path.join(REPO_DIR, "**", "*.mscx"), recursive=True))
    targets = all_scores[:3]
    
    for filepath in targets:
        name = "dcml_" + os.path.basename(filepath).split(".")[0].lower()
        render_score(name, filepath)
        
    shutil.rmtree(TMP_DIR, ignore_errors=True)
    print("\n✅ Rendering complete. Now re-run `python3 scripts/extract_features.py` and `python3 scripts/build_manifest.py`.")

if __name__ == "__main__":
    main()
