import ms3
import sys

# Load a DCML MSCX file
s = ms3.Score('assets/tmp_musescore/mozart_string_quartets/MS3/01op12a.mscx')
print("Metadata:", s.mscx.metadata)
print("\nStaves:")
try:
    for staff in s.mscx.metadata.get('parts', []):
        print(staff)
except Exception as e:
    print(e)
