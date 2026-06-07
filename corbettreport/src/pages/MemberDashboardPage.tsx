import { CreditCard, MessageSquare, User } from 'lucide-react';

export function MemberDashboardPage() {
  return (
    <section className="reserved-page">
      <p className="eyebrow">Reserved application area</p>
      <h1>Member Dashboard</h1>
      <p>This section is still under development. Membership tools and account details will be added in a later phase.</p>
      <div className="reserved-grid">
        <div><User /><strong>Account profile</strong><span>Qortal identity and membership state</span></div>
        <div><CreditCard /><strong>QORT membership</strong><span>Plans, payments and expiry history</span></div>
        <div><MessageSquare /><strong>Comments</strong><span>Member-authored QDN comment activity</span></div>
      </div>
    </section>
  );
}
