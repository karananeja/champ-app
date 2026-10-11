import { useCallback, useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { Crosshair, Loader2, MapPin, Search } from 'lucide-react';
import type { GeoResultDto } from '@champ/shared';
import { FieldError } from '@/components/FieldError';
import { PinMap, type LatLng } from '@/components/map/PinMap';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { useGeoSearch, reverseGeocode } from '@/features/clients/queries';
import { useDebounced } from '@/hooks/useDebounced';
import { cn } from '@/lib/utils';

export interface SitePickerValue {
  address: string;
  lat: number | null;
  lng: number | null;
}

export interface SitePickerProps {
  /** Prefix for element ids (several pickers can be on one page). */
  id: string;
  value: SitePickerValue;
  onChange: (next: SitePickerValue) => void;
  /** Called with the matching active Location (city) for a picked or reverse-geocoded place. */
  onSuggestLocation?: (locationId: string) => void;
  addressError?: string;
  pinError?: string;
  className?: string;
}

export const GEOCODER_UNAVAILABLE_MESSAGE = 'Address lookup is unavailable; place the pin and type the address';

/** Search results wait this long after the last keystroke (Nominatim allows 1 request a second). */
export const SEARCH_DEBOUNCE_MS = 500;
/** Reverse lookups after clicking the map or dragging the pin wait this long. */
export const REVERSE_DEBOUNCE_MS = 400;

const formatCoord = (v: number) => v.toFixed(5);

/**
 * Address + map pin input (F03, reusable in F04/F09). Search an address (debounced, via `/geo/search`) to
 * move the map and set the pin, or click/tap the map and drag the pin; the address is then filled by a
 * reverse lookup unless the user has typed it by hand. Geocoder failures show an inline message and manual
 * entry keeps working.
 */
export function SitePicker({
  id,
  value,
  onChange,
  onSuggestLocation,
  addressError,
  pinError,
  className,
}: SitePickerProps) {
  const [query, setQuery] = useState('');
  const [resultsOpen, setResultsOpen] = useState(false);
  const [focus, setFocus] = useState<LatLng | null>(null);
  const [reverseFailed, setReverseFailed] = useState(false);
  const [reversing, setReversing] = useState(false);
  const [locating, setLocating] = useState(false);
  const q = useDebounced(query.trim(), SEARCH_DEBOUNCE_MS);
  const search = useGeoSearch(resultsOpen ? q : '');

  // Latest props for async callbacks (reverse lookups resolve after later renders).
  const latest = useRef({ value, onChange, onSuggestLocation });
  useEffect(() => {
    latest.current = { value, onChange, onSuggestLocation };
  });
  /** True once the user typed the address by hand; reverse lookups then leave it alone. */
  const addressEdited = useRef(false);
  const reverseTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const reverseSeq = useRef(0);
  useEffect(() => () => clearTimeout(reverseTimer.current), []);

  const pickResult = (result: GeoResultDto) => {
    addressEdited.current = false;
    clearTimeout(reverseTimer.current);
    reverseSeq.current += 1; // a pending reverse lookup must not overwrite this address
    setResultsOpen(false);
    setQuery('');
    setReverseFailed(false);
    setFocus({ lat: result.lat, lng: result.lng });
    onChange({ address: result.displayName, lat: result.lat, lng: result.lng });
    if (result.suggestedLocationId) onSuggestLocation?.(result.suggestedLocationId);
  };

  const placePin = useCallback((lat: number, lng: number) => {
    const { value: current, onChange: change } = latest.current;
    change({ ...current, lat, lng });
    clearTimeout(reverseTimer.current);
    const seq = ++reverseSeq.current;
    reverseTimer.current = setTimeout(() => {
      setReversing(true);
      reverseGeocode(lat, lng)
        .then(({ item }) => {
          if (seq !== reverseSeq.current) return;
          setReverseFailed(false);
          if (!item) return;
          const { value: now, onChange: update, onSuggestLocation: suggest } = latest.current;
          if (!addressEdited.current) update({ ...now, address: item.displayName });
          if (item.suggestedLocationId) suggest?.(item.suggestedLocationId);
        })
        .catch(() => {
          if (seq === reverseSeq.current) setReverseFailed(true);
        })
        .finally(() => {
          if (seq === reverseSeq.current) setReversing(false);
        });
    }, REVERSE_DEBOUNCE_MS);
  }, []);

  const locateMe = () => {
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      ({ coords }) => {
        setLocating(false);
        setFocus({ lat: coords.latitude, lng: coords.longitude });
        placePin(coords.latitude, coords.longitude);
      },
      () => setLocating(false),
      { enableHighAccuracy: true, timeout: 10_000 },
    );
  };

  const onSearchKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault(); // don't submit the surrounding form
      const first = search.data?.items[0];
      if (first) pickResult(first);
    } else if (e.key === 'Escape') {
      setResultsOpen(false);
    }
  };

  const geocoderDown = search.isError || reverseFailed;
  const results = search.data?.items ?? [];
  const showResults = resultsOpen && q.length >= 3 && !search.isError;
  const hasPin = value.lat !== null && value.lng !== null;
  const canLocate = typeof navigator !== 'undefined' && 'geolocation' in navigator;

  return (
    <div className={cn('grid grid-cols-1 gap-3', className)}>
      <div className="relative grid grid-cols-1 gap-2">
        <Label htmlFor={`${id}-search`}>Search address</Label>
        <div className="relative">
          <Search className="absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            id={`${id}-search`}
            type="search"
            autoComplete="off"
            placeholder="Type an address, area or landmark"
            className="pl-8"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setResultsOpen(true);
            }}
            onFocus={() => setResultsOpen(true)}
            onKeyDown={onSearchKeyDown}
            aria-controls={`${id}-results`}
            aria-expanded={showResults}
          />
          {search.isFetching && (
            <Loader2 className="absolute top-1/2 right-2.5 size-4 -translate-y-1/2 animate-spin text-muted-foreground" />
          )}
        </div>
        {showResults && !search.isPending && (
          <ul
            id={`${id}-results`}
            role="listbox"
            aria-label="Address results"
            className="max-h-64 overflow-y-auto rounded-md border bg-popover text-sm shadow-md"
          >
            {results.length === 0 ? (
              <li className="px-3 py-2 text-muted-foreground">No matches. Try another search, or tap the map.</li>
            ) : (
              results.map((result) => (
                <li
                  key={`${result.lat},${result.lng},${result.displayName}`}
                  role="option"
                  aria-selected={false}
                  tabIndex={0}
                  className="flex cursor-pointer items-start gap-2 px-3 py-2 hover:bg-accent focus:bg-accent focus:outline-none"
                  onClick={() => pickResult(result)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      pickResult(result);
                    }
                  }}
                >
                  <MapPin className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
                  <span className="min-w-0 break-words">{result.displayName}</span>
                </li>
              ))
            )}
          </ul>
        )}
      </div>

      {geocoderDown && (
        <Alert role="alert" className="border-amber-200 bg-amber-50 text-amber-900">
          <AlertDescription className="text-amber-900">{GEOCODER_UNAVAILABLE_MESSAGE}</AlertDescription>
        </Alert>
      )}

      <PinMap
        position={hasPin ? { lat: value.lat!, lng: value.lng! } : null}
        onPick={placePin}
        focus={focus}
        className="h-72 md:h-80"
      />

      <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
        <span className="text-muted-foreground" data-testid={`${id}-coords`}>
          {hasPin ? (
            <>
              Pin: <span className="font-mono text-foreground">{formatCoord(value.lat!)}, {formatCoord(value.lng!)}</span>
            </>
          ) : (
            'No pin yet: search an address, or tap the map.'
          )}
          {reversing && <Loader2 className="ml-2 inline size-3 animate-spin" aria-label="Looking up address" />}
        </span>
        {canLocate && (
          <Button type="button" variant="outline" size="sm" onClick={locateMe} disabled={locating}>
            {locating ? <Loader2 className="animate-spin" /> : <Crosshair />} Use my location
          </Button>
        )}
      </div>
      <FieldError id={`${id}-pin-error`} message={pinError} />

      <div className="grid grid-cols-1 gap-2">
        <Label htmlFor={`${id}-address`}>Address</Label>
        <Textarea
          id={`${id}-address`}
          rows={2}
          value={value.address}
          aria-invalid={!!addressError}
          onChange={(e) => {
            addressEdited.current = true;
            onChange({ ...value, address: e.target.value });
          }}
        />
        <FieldError id={`${id}-address-error`} message={addressError} />
      </div>
    </div>
  );
}
