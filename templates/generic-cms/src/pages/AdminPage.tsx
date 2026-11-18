import { StateNotice } from '../components/StateNotice';
import { AccessDeniedPage } from './AccessDeniedPage';
import { formatDate } from '../lib/text.js';
import { adminHref } from '../lib/routes.js';
import type { AdminSection, CmsDataset, SectionsDocument, ViewerIdentity } from '../types';
import { SettingsPanel } from './admin/SettingsPanel';
import { EditorPage } from './admin/EditorPage';
import { GalleryAdmin } from './admin/GalleryAdmin';
import { TaxonomyAdmin } from './admin/TaxonomyAdmin';

function OwnerAdmin(props: {
  dataset: CmsDataset | null;
  loading?: boolean;
  identity: ViewerIdentity;
  section: AdminSection;
  onRefresh: () => void;
  templateVersion?: string;
  onCheckUpdates?: () => void;
  settingsConfig: any;
  qdnName: string;
  siteId: string;
  remoteSettings: unknown;
  onSettingsPreview: (draft: unknown | null) => void;
  onSettingsPublished: (settings: unknown) => void;
  galleries: any[];
  sections?: SectionsDocument | null;
  galleriesLoading: boolean;
  loadContent: any;
  initialEditorId?: string;
}) {
  return (
    <div className="page">
      <p className="eyebrow">Owner administration</p>
      <h1>Admin</h1>
      <nav className="admin-tabs" aria-label="Admin sections">
        <div className="admin-tabs__group" role="group" aria-label="Site">
          <span className="admin-tabs__label" aria-hidden="true">Site</span>
          <a href={adminHref('overview')} aria-current={props.section === 'overview' ? 'page' : undefined}>Overview</a>
          <a href={adminHref('settings')} aria-current={props.section === 'settings' ? 'page' : undefined}>Site settings</a>
        </div>
        <div className="admin-tabs__group" role="group" aria-label="Content">
          <span className="admin-tabs__label" aria-hidden="true">Content</span>
          <a href={adminHref('editor')} aria-current={props.section === 'editor' ? 'page' : undefined}>Posts</a>
          <a href={adminHref('pages')} aria-current={props.section === 'pages' ? 'page' : undefined}>Pages</a>
          <a href={adminHref('taxonomy')} aria-current={props.section === 'taxonomy' ? 'page' : undefined}>Categories &amp; tags</a>
        </div>
        <div className="admin-tabs__group" role="group" aria-label="Media">
          <span className="admin-tabs__label" aria-hidden="true">Media</span>
          <a href={adminHref('galleries')} aria-current={props.section === 'galleries' ? 'page' : undefined}>Galleries</a>
        </div>
      </nav>

      {props.section === 'settings' ? (
        <SettingsPanel
          pages={props.dataset ? props.dataset.pages : []}
          config={props.settingsConfig}
          identity={props.identity}
          qdnName={props.qdnName}
          siteId={props.siteId}
          remoteSettings={props.remoteSettings}
          onPreview={props.onSettingsPreview}
          onPublished={props.onSettingsPublished}
        />
      ) : null}

      {props.section === 'editor' || props.section === 'pages' ? (
        <EditorPage
          key={props.section}
          contentType={props.section === 'pages' ? 'page' : 'post'}
          identity={props.identity}
          name={props.qdnName}
          siteId={props.siteId}
          dataset={props.dataset}
          galleries={props.galleries}
          sections={props.sections || null}
          config={props.settingsConfig}
          loadContent={props.loadContent}
          onRefresh={props.onRefresh}
          initialId={props.initialEditorId}
        />
      ) : null}

      {props.section === 'taxonomy' ? (
        <TaxonomyAdmin
          identity={props.identity}
          name={props.qdnName}
          siteId={props.siteId}
          deployment={props.settingsConfig ? props.settingsConfig.deployment : undefined}
          dataset={props.dataset}
          onRefresh={props.onRefresh}
        />
      ) : null}

      {props.section === 'galleries' ? (
        <GalleryAdmin
          identity={props.identity}
          name={props.qdnName}
          siteId={props.siteId}
          dataset={props.dataset}
          galleries={props.galleries}
          onRefresh={props.onRefresh}
        />
      ) : null}

      {props.section === 'overview' ? (
        <>
          <p className="muted">
            This view inspects the published catalog. Publishing is explicit and owner-only; nothing here modifies
            QDN resources without an owner-approved action.
          </p>

          <section className="admin-section" aria-labelledby="updates-title">
            <h2 id="updates-title">CMS updates</h2>
            <p className="muted">Public visitors do not see update checks or template version information.</p>
            <p className="muted">Template v{props.templateVersion || 'unknown'}</p>
            <div className="admin-toolbar">
              <button type="button" className="button button--ghost" onClick={props.onCheckUpdates} disabled={!props.onCheckUpdates}>Check for updates</button>
            </div>
          </section>

          <section className="admin-section" aria-labelledby="access-title">
            <h2 id="access-title">Access</h2>
            <div className="access-card access-card--owner">
              <p>{props.identity.message}</p>
              <dl className="meta-grid">
                <div><dt>QDN name</dt><dd>{props.identity.qdnName || '(not configured)'}</dd></div>
                <div><dt>Account</dt><dd>{props.identity.address}</dd></div>
                <div><dt>Name record</dt><dd>{props.identity.nameRecordStatus}</dd></div>
                <div><dt>Verification</dt><dd>{props.identity.reason}</dd></div>
              </dl>
            </div>
          </section>

          <section className="admin-section" aria-labelledby="precondition-title">
            <h2 id="precondition-title">Catalog</h2>
            {!props.dataset ? (
              <StateNotice state={props.loading ? 'loading' : 'partial'} title={props.loading ? 'Reading the published catalog...' : 'No published catalog is available yet'} message={props.loading ? 'Admin stays reachable while the QDN catalog loads.' : 'No qms-cms-manifest could be read for this site. Publish the site with the Migration Publisher first, then refresh.'} />
            ) : props.dataset.state === 'error' ? (
              <StateNotice state="error" title="Catalog unavailable" message={props.dataset.message || 'The published catalog could not be read.'} notices={props.dataset.notices} />
            ) : (
              <p className="muted">Catalog state: <strong>{props.dataset.state}</strong>{props.dataset.source ? ' · source: ' + props.dataset.source : ''}{props.dataset.generatedAt ? ' · generated ' + formatDate(props.dataset.generatedAt) : ''}</p>
            )}
            <div className="admin-toolbar"><button type="button" className="button button--ghost" onClick={props.onRefresh}>Refresh catalog</button></div>
            {props.dataset ? (
              <dl className="meta-grid">
                <div><dt>Source</dt><dd>{props.dataset.source}</dd></div>
                <div><dt>Posts</dt><dd>{props.dataset.availability.posts ? props.dataset.posts.length : 'unavailable'}</dd></div>
                <div><dt>Pages</dt><dd>{props.dataset.availability.pages ? props.dataset.pages.length : 'unavailable'}</dd></div>
                <div><dt>CMS-authored</dt><dd>{props.dataset.posts.filter((item) => item.native).length}</dd></div>
                <div><dt>Categories</dt><dd>{props.dataset.availability.categories ? props.dataset.categories.length : 'unavailable'}</dd></div>
                <div><dt>Tags</dt><dd>{props.dataset.availability.tags ? props.dataset.tags.length : 'unavailable'}</dd></div>
              </dl>
            ) : null}
          </section>

        </>
      ) : null}
    </div>
  );
}

export function AdminPage(props: {
  dataset: CmsDataset | null;
  loading?: boolean;
  identity: ViewerIdentity | null;
  identityLoading: boolean;
  identityNotice: string;
  section?: AdminSection;
  onRefresh: () => void;
  templateVersion?: string;
  onCheckUpdates?: () => void;
  /** @deprecated Adoption was removed; kept optional for old embeddings only. */
  adoptionQueue?: any[];
  /** @deprecated */
  onAdopt?: (items: any[]) => any;
  /** @deprecated */
  onRemove?: (key: string) => void;
  /** @deprecated */
  onAuthorize?: () => Promise<{ ok: boolean; message: string }>;
  settingsConfig?: any;
  qdnName?: string;
  siteId?: string;
  remoteSettings?: unknown;
  onSettingsPreview?: (draft: unknown | null) => void;
  onSettingsPublished?: (settings: unknown) => void;
  galleries?: any[];
  sections?: SectionsDocument | null;
  galleriesLoading?: boolean;
  loadContent?: any;
  initialEditorId?: string;
  onConnectOwner?: () => void;
  onRetryIdentity?: () => void;
}) {
  if (props.identityLoading) {
    return <div className="page"><StateNotice state="loading" title="Checking QDN name ownership..." message="Administration opens only for the verified on-chain owner." /></div>;
  }
  const owner = Boolean(props.identity && props.identity.owner && props.identity.role === 'owner' && props.identity.nameRecordStatus === 'verified');
  if (!owner) {
    return (
      <AccessDeniedPage
        identity={props.identity}
        notice={props.identityNotice}
        busy={props.identityLoading}
        onConnect={props.onConnectOwner}
        onRetry={props.onRetryIdentity}
      />
    );
  }
  return (
    <OwnerAdmin
      dataset={props.dataset}
      loading={props.loading}
      identity={props.identity as ViewerIdentity}
      section={props.section || 'overview'}
      onRefresh={props.onRefresh}
      templateVersion={props.templateVersion}
      onCheckUpdates={props.onCheckUpdates}
      settingsConfig={props.settingsConfig || { site: {}, navigation: [], theme: { colors: {} } }}
      qdnName={props.qdnName || (props.identity ? props.identity.qdnName : '')}
      siteId={props.siteId || (props.dataset ? props.dataset.site.id : 'site')}
      remoteSettings={props.remoteSettings || null}
      onSettingsPreview={props.onSettingsPreview || (() => undefined)}
      onSettingsPublished={props.onSettingsPublished || (() => undefined)}
      galleries={props.galleries || []}
      sections={props.sections || null}
      galleriesLoading={Boolean(props.galleriesLoading)}
      loadContent={props.loadContent || (async () => { throw new Error('Content loading is unavailable.'); })}
      initialEditorId={props.initialEditorId}
    />
  );
}

