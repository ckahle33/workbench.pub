"""Packs PNG files into a PNG-in-ICO file. Usage: python3 make-ico.py out.ico a.png b.png ..."""
import struct
import sys

out, pngs = sys.argv[1], sys.argv[2:]
images = [open(p, 'rb').read() for p in pngs]
header = struct.pack('<HHH', 0, 1, len(images))
offset = 6 + 16 * len(images)
entries = b''
for data in images:
    w, h = struct.unpack('>II', data[16:24])  # IHDR width/height
    entries += struct.pack('<BBBBHHII', w % 256, h % 256, 0, 0, 1, 32, len(data), offset)
    offset += len(data)
open(out, 'wb').write(header + entries + b''.join(images))
