from pathlib import Path
import re, json
root=Path.cwd(); docs=root/'docs'
architecture={'vision-and-architecture','architecture-design','technical-decisions','design-risks-and-open-questions','content-resource-budgets','plugin-runtime-constraints','page-transfer-design','personal-settings-design','mcp-readonly-design','provider-local-ip-policy'}
plans={'development-plan','module-plan','requirements-traceability','remaining-milestones','conversational-workshop-plan'}
references={'reference-notes','reference-engineering-review','dsh-conversation-reference','dsh-provider-reference'}
features={'markdown-reading-layout','compact-content-hierarchy','wiki-reading-first','space-navigation'}
mapping={}
for p in docs.glob('*.md'):
 stem=p.stem
 category='status' if stem=='current-status' else 'decisions' if stem.startswith('adr-') else 'architecture' if stem in architecture else 'plans' if stem in plans else 'references' if stem in references else 'features' if stem in features else 'history'
 mapping[p.relative_to(root).as_posix()]=f'docs/{category}/{p.name}'
# Capture original contents before moves; no overwriting destination files.
texts={p:p.read_text(encoding='utf-8') for p in root.rglob('*.md') if not any(x in p.parts for x in ['node_modules','.git','.data','test-results'])}
for old,new in mapping.items():
 src=root/old; dest=root/new
 if dest.exists():raise RuntimeError(f'destination exists {dest}')
 dest.parent.mkdir(parents=True,exist_ok=True);src.rename(dest)
link=re.compile(r'(?P<pre>!?\[[^\]\n]*\]\()(?P<dest><[^>\n]+>|[^)\s]+)(?P<post>\))')
for original,text in texts.items():
 current=root/mapping.get(original.relative_to(root).as_posix(),original.relative_to(root).as_posix())
 def update(m):
  raw=m['dest']; angled=raw.startswith('<'); target=raw[1:-1] if angled else raw
  if re.match(r'^[A-Za-z][\w+.-]*:',target) or target.startswith('#') or target.startswith('/'):return m.group(0)
  path,sep,fragment=target.partition('#')
  resolved=(original.parent/path).resolve()
  try:key=resolved.relative_to(root).as_posix()
  except ValueError:return m.group(0)
  mapped=root/mapping.get(key,key)
  import os
  relative=os.path.relpath(mapped,current.parent).replace('\\','/')
  return m['pre']+'<'+relative+(sep+fragment if sep else '')+'>'+m['post']
 updated=link.sub(update,text)
 # Update bare repo-relative docs paths (source comments, prose, and examples).
 for old,new in mapping.items():updated=updated.replace(old,new)
 current.write_text(updated,encoding='utf-8')
(root/'scripts'/'docs-path-map.json').write_text(json.dumps(mapping,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
print(f'Classified {len(mapping)} documents; rewrote Markdown links from original locations.')
