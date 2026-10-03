import CustomerPage from "./CustomerPage.jsx";
import KitchenPage from "./KitchenPage.jsx";

export default function App() {
  const isKitchen = window.location.pathname === "/kitchen";

  return (
    <>
      <nav className="screen-nav">
        <a href="/" aria-current={!isKitchen ? "page" : undefined}>
          Customer
        </a>

        <a href="/kitchen" aria-current={isKitchen ? "page" : undefined}>
          Kitchen
        </a>
      </nav>

      {isKitchen ? <KitchenPage /> : <CustomerPage />}
    </>
  );
}
