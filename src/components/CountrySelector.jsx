export default function CountrySelector({ onSelect }) {
  const countries = ["Canada", "Australia", "UK", "Germany", "USA"];

  return (
    <div className="mt-6 grid grid-cols-2 gap-3">
      {countries.map((country) => (
        <button
          key={country}
          onClick={() => onSelect(country)}
          className="p-3 border rounded-lg bg-white hover:bg-gray-100"
        >
          {country}
        </button>
      ))}
    </div>
  );
}
