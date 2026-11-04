import type { CatalogNotice } from '../types';

export type NoticeState = 'loading' | 'empty' | 'partial' | 'stale' | 'error';

const DEFAULT_TITLES: Record<NoticeState, string> = {
  loading: 'Loading',
  empty: 'No published content yet',
  partial: 'Part of the catalog is unavailable',
  stale: 'The catalog may be out of date',
  error: 'The catalog could not be loaded'
};

export function StateNotice(props: {
  state: NoticeState;
  title?: string;
  message?: string;
  notices?: CatalogNotice[];
  compact?: boolean;
}) {
  const title = props.title || DEFAULT_TITLES[props.state];
  const isError = props.state === 'error';
  const visibleNotices = (props.notices || []).filter((notice) => notice.level !== 'info');
  return (
    <div
      className={'state-notice state-notice--' + props.state + (props.compact ? ' state-notice--compact' : '')}
      role={isError ? 'alert' : 'status'}
      aria-live={isError ? 'assertive' : 'polite'}
    >
      <strong className="state-notice__title">{title}</strong>
      {props.message ? <p className="state-notice__message">{props.message}</p> : null}
      {visibleNotices.length > 0 ? (
        <ul className="state-notice__list">
          {visibleNotices.map((notice) => (
            <li key={notice.code + notice.message}>{notice.message}</li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
