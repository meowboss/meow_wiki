from pathlib import Path
root=Path.cwd();docs=root/'docs'
labels={'status':('当前状态','当前有效事实入口；源码与测试优先，历史数字不外推。'),'architecture':('架构与边界','目标设计与资源边界；文首标识适用状态，不能据设计推断全部已实现。'),'decisions':('架构决策 ADR','保留原始取舍。Provider网络政策以后继具体IP策略为准。'),'features':('功能与交互','当前用户流程；测试结果仅代表文内记录的快照。'),'plans':('开发计划','计划和需求追踪；未完成目标不代表现有功能。'),'references':('参考研究','外部项目源码研究；本机绝对引用仅原机器可用，不构成本项目授权。'),'history':('历史交付与验证','只证明各自阶段快照，不作为当前规格；测试数字与当时网络结果保持原样。'),'guides':('维护指南','知识库维护与操作约定。')}
for folder,(title,desc) in labels.items():
 directory=docs/folder;directory.mkdir(exist_ok=True)
 lines=[f'# {title}', '',desc,'','[返回知识库](<../README.md>)','','## 文档','']
 for p in sorted(directory.glob('*.md')):
  if p.name=='README.md':continue
  heading=next((line.lstrip('# ').strip() for line in p.read_text(encoding='utf-8').splitlines() if line.startswith('# ')),p.stem)
  lines.append(f'- [{heading}](<{p.name}>)')
 (directory/'README.md').write_text('\n'.join(lines)+'\n',encoding='utf-8')
print('Built 8 category indexes')
