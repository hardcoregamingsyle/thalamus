// Portal route dispatcher. Auth is checked BEFORE the mobile split:
// unauthenticated visitors get GuestPortal on every device. The old order
// handed mobile visitors to MobilePortal first, which immediately redirected
// them to /auth — a sign-in wall for exactly the first-touch traffic guest
// mode exists to convert.

import { useAuth } from "@/hooks/use-auth";
import { useIsMobile } from "@/hooks/use-mobile";
import MobilePortal from "./MobilePortal";
import GuestPortal from "./portal/GuestPortal";
import PortalDesktop from "./portal/PortalDesktop";

export default function Portal() {
  const isMobile = useIsMobile();
  const { isLoading, isAuthenticated } = useAuth();

  return (
    <>
      <meta name="robots" content="noindex" />
      {!isLoading && !isAuthenticated ? <GuestPortal /> : isMobile ? <MobilePortal /> : <PortalDesktop />}
    </>
  );
}
