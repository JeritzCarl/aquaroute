export interface LatLng {
  lat: number;
  lng: number;
}

// 🔹 Simple geocoder for Tuguegarao addresses
export async function geocodeTuguegarao(address: string): Promise<LatLng | null> {
  if (!address || !address.trim()) return null;

  try {
    const query = `${address}, Tuguegarao City, Cagayan, Philippines`;
    const url = `https://nominatim.openstreetmap.org/search?format=json&limit=1&countrycodes=ph&viewbox=121.68,17.67,121.79,17.58&bounded=1&q=${encodeURIComponent(
      query
    )}`;

    const res = await fetch(url, { headers: { 'Accept-Language': 'en' } });
    const data = await res.json();

    if (Array.isArray(data) && data.length > 0) {
      const lat = parseFloat(data[0].lat);
      const lng = parseFloat(data[0].lon);
      return { lat, lng };
    }
  } catch (err) {
    console.warn('⚠️ Geocoding failed:', err);
  }

  return null;
}
