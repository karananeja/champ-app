import { SvgXml } from 'react-native-svg';
import type { Palette } from '../theme/colors';
import { useTheme } from '../theme/use-theme';
import loginSvg from '../illustrations/login';
import offlineSvg from '../illustrations/offline';
import serverErrorSvg from '../illustrations/server-error';
import tasksEmptySvg from '../illustrations/tasks-empty';

const SOURCES = { login: loginSvg, offline: offlineSvg, 'server-error': serverErrorSvg, 'tasks-empty': tasksEmptySvg };
export type IllustrationName = keyof typeof SOURCES;

/** unDraw colours → theme colours, the same remapping as the web `.illustration` CSS. */
export function recolour(svg: string, il: Palette['il']): string {
  const map: Record<string, string> = {
    '#6c63ff': il.accent,
    '#090814': il.ink,
    '#2f2e41': il.ink,
    '#3f3d56': il.inkSoft,
    '#fff': il.paper,
    '#ffffff': il.paper,
    '#f2f2f2': il.surface,
    '#e6e6e6': il.surface2,
    '#e5e5e5': il.surface2,
    '#e4e4e4': il.surface2,
    '#ccc': il.line,
    '#d6d6e3': il.line,
    '#b6b3c5': il.line,
    '#6f6f6f': il.line,
    '#707070': il.line,
  };
  return svg.replace(/(fill|stroke)="(#[0-9a-fA-F]{3,6})"/g, (all, attr: string, hex: string) => {
    const to = map[hex.toLowerCase()];
    return to ? `${attr}="${to}"` : all;
  });
}

export function Illustration({ name, height = 160 }: { name: IllustrationName; height?: number }) {
  const { colors } = useTheme();
  return (
    <SvgXml
      testID={`illustration-${name}`}
      xml={recolour(SOURCES[name], colors.il)}
      width="100%"
      height={height}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    />
  );
}
