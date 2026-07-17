import { useEffect, useState } from "react";
import { useNavigate, useRouter } from "@tanstack/react-router";
import { ChevronDown, LogOut } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";

// O enum user_role no banco tem 4 valores. A tipagem anterior omitia `head`,
// o que fazia roleLabel[profile.role] retornar undefined para esse perfil.
type Role = "super_admin" | "admin" | "head" | "tech";

type Profile = {
  email: string | null;
  full_name: string | null;
  role: Role;
};

const roleLabel: Record<Role, string> = {
  super_admin: "Super Admin",
  admin: "Administrador",
  head: "Supervisor",
  tech: "Técnico",
};

function initials(name?: string | null, email?: string | null) {
  const src = (name ?? "").trim();
  if (src) {
    const parts = src.split(/\s+/);
    const first = parts[0]?.[0] ?? "";
    const last = parts.length > 1 ? parts[parts.length - 1]![0] : "";
    const out = (first + last).toUpperCase();
    if (out) return out;
  }
  return (email?.[0] ?? "?").toUpperCase();
}

export function UserMenu() {
  const navigate = useNavigate();
  const router = useRouter();
  const queryClient = useQueryClient();
  const [profile, setProfile] = useState<Profile | null>(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      const { data: userData } = await supabase.auth.getUser();
      if (!userData.user) return;
      const { data } = await supabase
        .from("profiles")
        .select("email, full_name, role")
        .eq("id", userData.user.id)
        .maybeSingle();
      if (alive && data) setProfile(data as Profile);
    })();
    return () => {
      alive = false;
    };
  }, []);

  async function signOut() {
    await queryClient.cancelQueries();
    queryClient.clear();
    await supabase.auth.signOut();
    router.invalidate();
    navigate({ to: "/auth", replace: true });
  }

  const displayName = profile?.full_name || profile?.email || "Usuário";

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="sm" className="gap-2.5 h-9 px-2 hover:bg-surface-hover">
          <span
            className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-primary/12 text-[10.5px] font-semibold tracking-wide text-primary"
            aria-hidden
          >
            {initials(profile?.full_name, profile?.email)}
          </span>
          <span className="hidden sm:flex flex-col items-start leading-tight min-w-0">
            <span className="text-[12.5px] font-medium text-foreground truncate max-w-[140px]">
              {displayName}
            </span>
            {profile && (
              <span className="text-[10.5px] text-text-dim">{roleLabel[profile.role]}</span>
            )}
          </span>
          <ChevronDown className="h-3.5 w-3.5 shrink-0 text-text-dim" strokeWidth={1.75} />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuLabel>
          <div className="flex flex-col">
            <span className="text-sm">{profile?.full_name || "—"}</span>
            <span className="text-xs text-muted-foreground">{profile?.email}</span>
          </div>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={signOut} className="text-destructive focus:text-destructive">
          <LogOut className="mr-2 h-4 w-4" /> Sair
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
