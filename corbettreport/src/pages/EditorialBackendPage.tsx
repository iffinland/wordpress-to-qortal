import { FileText, Image, Settings, Upload } from 'lucide-react';

export function EditorialBackendPage() {
  return (
    <section className="reserved-page">
      <p className="eyebrow">Reserved application area</p>
      <h1>Editorial Backend</h1>
      <p>This route will host SysOp and coauthor workflows. It remains separate from the public layout and member dashboard.</p>
      <div className="reserved-grid">
        <div><FileText /><strong>Posts and pages</strong><span>Create, edit and override migrated content</span></div>
        <div><Image /><strong>Media library</strong><span>Images, documents, audio and video manifests</span></div>
        <div><Upload /><strong>Migration intake</strong><span>Combine importer manifests from multiple QDN publishers</span></div>
        <div><Settings /><strong>Site settings</strong><span>Roles, routes and publishing names</span></div>
      </div>
    </section>
  );
}
