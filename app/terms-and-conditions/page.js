import { LegalDocument } from "@/components/shared/LegalDocument";
import { termsContent } from "@/lib/legal-content";

export const metadata = {
  title: "Terms & Conditions",
  description: "Brokerage AI Terms and Conditions of Service.",
};

export default function TermsAndConditionsPage() {
  return <LegalDocument title="Terms & Conditions" content={termsContent} />;
}
