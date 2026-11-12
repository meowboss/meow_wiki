from pathlib import Path
root=Path.cwd()/'docs'
for category in ['history','architecture','decisions','plans','references']:
 for p in (root/category).glob('*.md'):
  if p.name=='README.md':continue
  text=p.read_text(encoding='utf-8');head,sep,body=text.partition('\n')
  note={'history':'历史快照：保留当时事实、测试数字及限制；不代表当前规格。','architecture':'设计/边界文档：可能含早期目标与原型现状，是否已实现须查当前状态。','decisions':'决策记录：保留原始采纳/待评审语境，后续实现与替代关系须查当前状态。','plans':'规划记录：未完成项需核对当前状态，不把历史“待确认”视为新的审批要求。','references':'参考研究：描述研究时的外部源码与本项目候选方案，不覆盖现行实现与策略。'}[category]
  note=f'> 文档性质：{note} [当前状态](<../status/current-status.md>) · [知识库入口](<../README.md>)'
  if p.name in ['adr-provider-user-configuration.md','provider-settings-delivery.md','dsh-provider-reference.md']:
   note+='\n> 网络策略已被[具体IP本地模型策略](<../architecture/provider-local-ip-policy.md>)取代，正文旧限制仅留作演进记录。'
  if '> 文档性质：' not in text:p.write_text(head+'\n\n'+note+'\n'+body,encoding='utf-8')
print('Annotated document authority and supersession without rewriting historical results.')
