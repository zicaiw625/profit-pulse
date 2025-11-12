import { useLocation, useNavigate } from "react-router";

export function LinkWithQuery({ to, onClick, children, ...props }) {
  const { search } = useLocation();
  const navigate = useNavigate();
  const destination = `${to}${search || ""}`;

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
