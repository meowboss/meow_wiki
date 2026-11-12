import { useEffect, useState } from 'react';

const storageKey = 'meow.sidebar.compact';
// Keep this aligned with the sidebar drawer breakpoint in styles.css.
const desktopQuery = '(min-width: 781px)';

export default function useSidebarCompact() {
  const [preference, setPreference] = useState(() => {
    try {
      return window.localStorage.getItem(storageKey) === 'true';
    } catch {
      return false;
    }
  });
  const [desktop, setDesktop] = useState(
    () => typeof window !== 'undefined' && window.matchMedia(desktopQuery).matches,
  );

  useEffect(() => {
    const media = window.matchMedia(desktopQuery);
    const update = () => setDesktop(media.matches);
    update();
    media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, []);

  useEffect(() => {
    try {
      window.localStorage.setItem(storageKey, String(preference));
    } catch {
      // The sidebar still works when browser storage is unavailable.
    }
  }, [preference]);

  return {
    sidebarCompact: desktop && preference,
    toggleSidebarCompact: () => setPreference((current) => !current),
  };
}
