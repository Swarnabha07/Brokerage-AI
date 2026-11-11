import { LegalDocument } from "@/components/shared/LegalDocument";
import { privacyContent } from "@/lib/legal-content";

export const metadata = {
  title: "Privacy Policy",
  description: "Brokerage AI Privacy Policy.",
};

export default function PrivacyPolicyPage() {
  return <LegalDocument title="Privacy Policy" content={privacyContent} />;
}
