import { useNavigate } from "react-router";
import { useAppUrlBuilder } from "../hooks/useAppUrlBuilder";

export function LinkWithQuery({ to, onClick, children, ...props }) {
  const buildAppUrl = useAppUrlBuilder();
  const navigate = useNavigate();
  const destination = buildAppUrl(to || "") || to || "";

  const handleClick = (event) => {
    if (typeof onClick === "function") {
      onClick(event);
    }
    if (event.defaultPrevented) return;
    event.preventDefault();
    navigate(destination);
  };

  return (
    <s-link {...props} href={destination} onClick={handleClick}>
      {children}
    </s-link>
  );
}
