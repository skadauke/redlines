import re, sys, zipfile, shutil
src, dst = sys.argv[1], sys.argv[2]
z = zipfile.ZipFile(src); s = z.read('word/document.xml').decode()
n = [500]
def a(who):
    n[0] += 1; return f'w:id="{n[0]}" w:author="{who}" w:date="2026-10-13T12:00:00Z"'
# column insertion: cellIns + inserted text
def cellins(m):
    return (f'<w:tc><w:tcPr><w:tcW w:type="dxa" w:w="2400"/><w:cellIns {a("Bob")}/></w:tcPr><w:p><w:pPr><w:rPr><w:ins {a("Bob")}/></w:rPr></w:pPr>'
            f'<w:ins {a("Bob")}><w:r><w:t xml:space="preserve">{m.group(1)}</w:t></w:r></w:ins></w:p></w:tc>')
s = re.sub(r'<w:tc><w:tcPr><w:tcW w:type="dxa" w:w="2400"/></w:tcPr><w:p><w:r><w:t xml:space="preserve">CELLINS ([^<]*)</w:t></w:r></w:p></w:tc>', cellins, s)
# images
for tag, el, who in [('IMGINS', 'ins', 'Carol'), ('IMGDEL', 'del', 'Alice')]:
    s = re.sub(rf'<w:r><w:t xml:space="preserve">{tag} </w:t></w:r>(<w:r><w:drawing>.*?</w:drawing></w:r>)',
               lambda m: f'<w:{el} {a(who)}>{m.group(1)}</w:{el}>', s, count=1)
# move
def mv(kind, text):
    tag = 'moveTo' if kind == 'MOVETO' else 'moveFrom'
    # Moved-from text stays in w:t (not w:delText), and each range needs its own id;
    # the two ranges are linked by w:name.
    rid = 900 if tag == 'moveTo' else 901
    return (f'<w:p><w:pPr><w:rPr><w:{tag} {a("Alice")}/></w:rPr></w:pPr><w:{tag}RangeStart w:id="{rid}" w:author="Alice" w:date="2026-10-13T12:00:00Z" w:name="move1"/>'
            f'<w:{tag} {a("Alice")}><w:r><w:t xml:space="preserve">{text}</w:t></w:r></w:{tag}><w:{tag}RangeEnd w:id="{rid}"/></w:p>')
s = re.sub(r'<w:p><w:r><w:t xml:space="preserve">(MOVETO|MOVEFROM) ([^<]*)</w:t></w:r></w:p>', lambda m: mv(m.group(1), m.group(2)), s)
assert 'CELLINS' not in s and 'IMGINS' not in s and 'MOVE' not in s, 'marker left'
zo = zipfile.ZipFile(dst, 'w', zipfile.ZIP_DEFLATED)
for i in z.infolist():
    zo.writestr(i, s if i.filename == 'word/document.xml' else z.read(i.filename))
zo.close()
