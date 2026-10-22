import type { SVGProps } from 'react';

const base: SVGProps<SVGSVGElement> = {
  width: 18,
  height: 18,
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.6,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
  'aria-hidden': true,
};

const make = (paths: string[]) =>
  function Icon(props: SVGProps<SVGSVGElement>) {
    return (
      <svg {...base} {...props}>
        {paths.map((d) => (
          <path key={d} d={d} />
        ))}
      </svg>
    );
  };

export const IconLedger = make(['M4 4h16v16H4z', 'M4 9h16', 'M4 14h16', 'M10 4v16']);
export const IconPlus = make(['M12 5v14', 'M5 12h14']);
export const IconFile = make(['M7 3h7l5 5v13H7z', 'M14 3v5h5', 'M10 13h6', 'M10 17h6']);
export const IconUpload = make(['M12 16V4', 'M7 9l5-5 5 5', 'M4 20h16']);
export const IconCheck = make(['M5 12.5l4.5 4.5L19 7.5']);
export const IconX = make(['M6 6l12 12', 'M18 6L6 18']);
export const IconAlert = make(['M12 4l9 16H3z', 'M12 10v4', 'M12 17.2v.1']);
export const IconArrowRight = make(['M5 12h14', 'M13 6l6 6-6 6']);
export const IconArrowLeft = make(['M19 12H5', 'M11 6l-6 6 6 6']);
export const IconCopy = make(['M8 8h11v12H8z', 'M5 16V4h11']);
export const IconDownload = make(['M12 4v12', 'M7 11l5 5 5-5', 'M4 20h16']);
export const IconSearch = make(['M11 4a7 7 0 100 14 7 7 0 000-14z', 'M20 20l-4-4']);
export const IconRefresh = make(['M20 11a8 8 0 00-14-4L4 9', 'M4 4v5h5', 'M4 13a8 8 0 0014 4l2-2', 'M20 20v-5h-5']);
export const IconSwatch = make(['M4 4h7v7H4z', 'M13 4h7v7h-7z', 'M4 13h7v7H4z', 'M17 13v7', 'M13.5 16.5h7']);
export const IconArrowUpRight = make(['M7 17L17 7', 'M8 7h9v9']);
export const IconArrowDown = make(['M12 5v14', 'M6 13l6 6 6-6']);
