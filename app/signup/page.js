import { AuthForm } from "@/components/features/auth/AuthForm";

export const metadata = { title: "Sign up" };

export default function Page() {
  return (
    <div className="flex justify-center px-6 py-16">
      <AuthForm mode="signup" />
    </div>
  );
}
