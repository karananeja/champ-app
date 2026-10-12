import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { osmMapUrl } from '@/lib/maps';
import { HomeLocation } from './home-location';

describe('HomeLocation (F09)', () => {
  it('shows "Not set" when there is none', () => {
    render(<HomeLocation value={null} />);
    expect(screen.getByText('Not set')).toBeInTheDocument();
    expect(screen.queryByRole('link')).not.toBeInTheDocument();
  });

  it('shows the address, an OpenStreetMap link and the IST update date', () => {
    // 18:45 UTC on 11 Oct is 00:15 IST on 12 Oct.
    render(<HomeLocation value={{ lat: 12.9716, lng: 77.5946, address: '12 MG Road, Bengaluru', updatedAt: '2026-10-11T18:45:00.000Z' }} />);
    expect(screen.getByText('12 MG Road, Bengaluru')).toBeInTheDocument();
    const link = screen.getByRole('link', { name: /open map/i });
    expect(link).toHaveAttribute('href', 'https://www.openstreetmap.org/?mlat=12.9716&mlon=77.5946#map=17/12.9716/77.5946');
    expect(link).toHaveAttribute('target', '_blank');
    expect(screen.getByText('Updated 12 Oct 2026')).toBeInTheDocument();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it('builds the map URL', () => {
    expect(osmMapUrl(-1.5, 30)).toBe('https://www.openstreetmap.org/?mlat=-1.5&mlon=30#map=17/-1.5/30');
  });
});
