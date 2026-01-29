import { useEffect, useMemo, useState } from 'react';
import { X, Tag, Plus } from 'lucide-react';
import './TagEditModal.css';

interface TagEditModalProps {
  isOpen: boolean;
  initialTags: string[];
  availableTags?: string[];
  onClose: () => void;
  onSave: (tags: string[]) => void | Promise<void>;
}

const MAX_TAGS = 10;
const MAX_TAG_LENGTH = 20;

const normalizeTag = (value: string) => value.trim().toLowerCase();

const normalizeTagList = (tags: string[]) => {
  const seen = new Set<string>();
  const result: string[] = [];
  tags.forEach((tag) => {
    const normalized = normalizeTag(tag);
    if (!normalized) return;
    if (seen.has(normalized)) return;
    seen.add(normalized);
    result.push(normalized);
  });
  return result;
};

export const TagEditModal = ({ isOpen, initialTags, availableTags = [], onClose, onSave }: TagEditModalProps) => {
  const [tags, setTags] = useState<string[]>([]);
  const [inputValue, setInputValue] = useState('');
  const [error, setError] = useState<string>('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!isOpen) return;
    setTags(normalizeTagList(initialTags));
    setInputValue('');
    setError('');
  }, [isOpen, initialTags]);

  const remaining = useMemo(() => MAX_TAGS - tags.length, [tags.length]);
  const normalizedAvailableTags = useMemo(() => normalizeTagList(availableTags), [availableTags]);
  const suggestedTags = useMemo(() => {
    const base = normalizedAvailableTags.filter((tag) => !tags.includes(tag));
    const query = normalizeTag(inputValue);
    if (!query) return base;
    return base.filter((tag) => tag.includes(query));
  }, [normalizedAvailableTags, tags, inputValue]);

  const addTag = (rawValue: string) => {
    const normalized = normalizeTag(rawValue);
    if (!normalized) {
      setError('标签不能为空');
      return;
    }
    if (normalized.length > MAX_TAG_LENGTH) {
      setError('标签长度不能超过 20 个字符');
      return;
    }
    if (tags.includes(normalized)) {
      setError('标签已存在');
      return;
    }
    if (tags.length >= MAX_TAGS) {
      setError('标签数量不能超过 10 个');
      return;
    }
    setTags((prev) => [...prev, normalized]);
    setInputValue('');
    setError('');
  };

  const removeTag = (target: string) => {
    setTags((prev) => prev.filter((tag) => tag !== target));
    setError('');
  };

  const handleSave = async () => {
    if (saving) return;
    setSaving(true);
    try {
      await onSave(tags);
      onClose();
    } finally {
      setSaving(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal tag-edit-modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2 className="tag-edit-title">
            <Tag size={18} />
            账户标签
          </h2>
          <button className="modal-close" onClick={onClose} aria-label="关闭">
            <X size={18} />
          </button>
        </div>
        <div className="modal-body tag-edit-body">
          <div className="tag-edit-hint">
            最多 10 个标签，单个标签长度不超过 20 个字符。
          </div>
          <div className="tag-list">
            {tags.length === 0 ? (
              <div className="tag-empty">暂无标签</div>
            ) : (
              tags.map((tag) => (
                <span key={tag} className="tag-chip">
                  {tag}
                  <button type="button" className="tag-remove" onClick={() => removeTag(tag)} aria-label="删除标签">
                    <X size={12} />
                  </button>
                </span>
              ))
            )}
          </div>
          {normalizedAvailableTags.length > 0 && (
            <div className="tag-suggestions">
              <div className="tag-suggestions-title">已有标签</div>
              {suggestedTags.length === 0 ? (
                <div className="tag-suggestions-empty">暂无可选标签</div>
              ) : (
                <div className="tag-suggestions-list">
                  {suggestedTags.map((tag) => (
                    <button
                      key={tag}
                      type="button"
                      className="tag-suggestion"
                      onClick={() => addTag(tag)}
                    >
                      <Tag size={12} />
                      {tag}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
          <div className="tag-input-row">
            <div className="tag-input-wrap">
              <input
                type="text"
                value={inputValue}
                onChange={(e) => {
                  setInputValue(e.target.value);
                  if (error) setError('');
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    addTag(inputValue);
                  }
                }}
                placeholder={remaining > 0 ? `输入标签（还能添加 ${remaining} 个）` : '已达到标签上限'}
                disabled={remaining <= 0}
              />
              <button
                type="button"
                className="btn btn-secondary tag-add-btn"
                onClick={() => addTag(inputValue)}
                disabled={!inputValue.trim() || remaining <= 0}
              >
                <Plus size={14} />
                添加
              </button>
            </div>
          </div>
          {error && <div className="tag-edit-error">{error}</div>}
        </div>
        <div className="modal-footer tag-edit-footer">
          <button className="btn btn-secondary" onClick={onClose} disabled={saving}>
            取消
          </button>
          <button className="btn btn-primary" onClick={handleSave} disabled={saving}>
            {saving ? '保存中...' : '保存标签'}
          </button>
        </div>
      </div>
    </div>
  );
};

export default TagEditModal;
