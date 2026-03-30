# Verbier Curator - Data Recovery Guide

This repository contains the source code for the Verbier Festival Curator installation and web experience. To keep the Git repository fast and within size limitations, large media files (audio stems, video assets, high-res images) are **excluded** from version control.

If you have just cloned this repository or need to restore missing media assets, please follow the steps below.

## Excluded Directories & Files

The following asset types and directories are tracked entirely on the Synology NAS rather than in GitHub:
- `verbier-curator/public/assets/audio/` (All `.wav`, `.ogg`, `.mp3` mixes)
- `verbier-curator/public/assets/stems/` (All individual instrument tracks)
- `verbier-curator/public/assets/video/` (Optional video performances and backgrounds)
- Any compiled or dependency files (e.g. `node_modules/`, `dist/`, `.env`)

## Recovery Instructions (For Mac/Unix environments)

### 1. Connect to the Synology NAS
The raw and rendered datasets are hosted on the EMPLUS Synology NAS.
Ensure your Mac has the NAS mounted at `/Volumes/EMPLUS-Students/`.

*If your NAS is disconnected, mount it via Finder (Go -> Connect to Server -> `smb://[nas-address]`).*

### 2. Locate the Source Assets
The complete rendered assets needed for the web app are stored in:
`/Volumes/EMPLUS-Students/CDS 2026/Datasets/Verbier Archive/Rendered Deliverables/`
*(Note: Path may vary. Please check the `Datasets/Verbier Archive` parent directory if the structure changes over time.)*

### 3. Copy Assets to Local Public Directory
To restore functionality to the `verbier-curator` front end, you need to copy the `audio`, `stems`, and any corresponding `manifests` into the `public/assets/` directory.

Run the equivalent of these commands in your terminal:

```bash
# 1. Navigate to your local Verbier Curator public assets folder
cd "/Volumes/EMPLUS-Students/CDS 2026/Project Space/Verbier/verbier-curator/public/assets/"

# 2. Copy the audio mix files
cp -R "/Volumes/EMPLUS-Students/CDS 2026/Datasets/Verbier Archive/Rendered Deliverables/audio/" ./audio/

# 3. Copy the instrument stems
cp -R "/Volumes/EMPLUS-Students/CDS 2026/Datasets/Verbier Archive/Rendered Deliverables/stems/" ./stems/
```

### 4. Verify Local Environment
Once the files are recovered, start the development server to ensure assets load correctly:
```bash
cd verbier-curator
npm install
npm run dev
```

*Note: This document should be updated with exact directory paths if the pipeline output structure is modified in future iterations.*
