type Props = {
  path: string;
  content: string;
  editable: boolean;
  page: boolean;
  working: boolean;
  dirty: boolean;
  onChange: (content: string) => void;
  onSave: () => void;
};

export default function WorkshopSource({
  path,
  content,
  editable,
  page,
  working,
  dirty,
  onChange,
  onSave,
}: Props) {
  return (
    <section className="workshop-editor" aria-label="高级：声明式 JSON 编辑">
      <p>
        {editable ? '手动改动需先保存，再校验、继续对话或应用。' : '只读虚拟 SDK；不能修改或执行。'}
      </p>
      <label>
        {editable ? `声明式${page ? '页面' : '组件'} JSON（${path}）` : `只读文件（${path}）`}
        <textarea
          className="workshop-json"
          maxLength={30000}
          value={content}
          onChange={(event) => onChange(event.target.value)}
          spellCheck={false}
          disabled={working}
          readOnly={!editable}
          rows={18}
        />
      </label>
      {editable && (
        <button className="secondary-btn" disabled={working || !dirty} onClick={onSave}>
          保存 JSON
        </button>
      )}
      {dirty && <p>JSON 未保存；对话、项目刷新和应用暂不可用，避免覆盖编辑。</p>}
    </section>
  );
}
