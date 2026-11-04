import { AuthForm } from "@/components/features/auth/AuthForm";

export const metadata = { title: "Log in" };

export default function Page() {
  return (
    <div className="flex justify-center px-6 py-16">
      <AuthForm mode="login" />
    </div>
  );
}
