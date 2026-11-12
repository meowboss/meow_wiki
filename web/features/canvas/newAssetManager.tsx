export function encodeBase64(buffer: ArrayBuffer) {
  const bytes = new Uint8Array(buffer);
  const chunks: string[] = [];
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    chunks.push(String.fromCharCode(...bytes.subarray(offset, offset + 0x8000)));
  }
  return btoa(chunks.join(''));
}

export function readFile(reader: FileReader, file: File): Promise<ArrayBuffer> {
  return new Promise((resolve, reject) => {
    reader.onload = () => {
      if (reader.result instanceof ArrayBuffer) resolve(reader.result);
      else reject(new Error('无法读取媒体文件。'));
    };
    reader.onerror = () => reject(new Error('媒体文件读取失败，请重新选择。'));
    reader.onabort = () => reject(new Error('媒体文件读取已取消。'));
    reader.readAsArrayBuffer(file);
  });
}

export type AssetMetadata = { id: string; name: string; mime: string; bytes: number };

type Props = {
  assets: AssetMetadata[];
  selectedId: string;
  disabled: boolean;
  onDelete: (asset: AssetMetadata) => void;
};

export default function AssetManager({ assets, selectedId, disabled, onDelete }: Props) {
  return (
    <details className="canvas-media-asset-manager">
      <summary>管理素材</summary>
      <p className="canvas-media-inspector-hint">
        删除不可恢复；已保存布局引用的素材须先修改布局并保存，再删除素材。
      </p>
      {assets.length === 0 ? (
        <p className="canvas-media-inspector-hint">暂无可管理的素材。</p>
      ) : (
        <ul>
          {assets.map((asset) => (
            <li key={asset.id}>
              <span>
                <strong>{asset.name}</strong>
                <small>
                  {asset.bytes.toLocaleString()} bytes
                  {asset.id === selectedId ? ' · 当前选择' : ''}
                </small>
              </span>
              <button
                type="button"
                disabled={disabled}
                aria-label={`删除素材 ${asset.name}`}
                onClick={() => onDelete(asset)}
              >
                删除素材 {asset.name}
              </button>
            </li>
          ))}
        </ul>
      )}
    </details>
  );
}
