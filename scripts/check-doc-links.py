from pathlib import Path
import re,sys
root=Path.cwd(); errors=[]; checked=0; skipped=0
pattern=re.compile(r'!?\[[^\]\n]*\]\((<[^>\n]+>|[^)\s]+)\)')
files=[root/'README.md',*sorted((root/'docs').rglob('*.md'))]
for file in files:
 text=file.read_text(encoding='utf-8')
 for match in pattern.finditer(text):
  target=match[1].strip('<>')
  if re.match(r'^[A-Za-z][\w+.-]*:',target) or target.startswith(('#','/')):skipped+=1;continue
  path=target.split('#')[0]
  if not path:continue
  checked+=1
  if not (file.parent/path).exists():errors.append(f'{file.relative_to(root)}: missing {path}')
for category in (root/'docs').iterdir():
 if not category.is_dir():continue
 index=category/'README.md'
 if not index.exists():errors.append(f'{category.relative_to(root)}: missing category README');continue
 indexed=index.read_text(encoding='utf-8')
 for doc in category.glob('*.md'):
  if doc.name!='README.md' and f'<{doc.name}>' not in indexed:errors.append(f'{doc.relative_to(root)}: absent from category index')
for p in (root/'docs').glob('*.md'):
 if p.name not in ('README.md','AGENTS.md'):errors.append(f'{p.relative_to(root)}: unclassified root document')
print(f'Checked {checked} local links; skipped {skipped} external/absolute/fragment references; {len(errors)} errors.')
for error in errors:print(error)
sys.exit(bool(errors))
