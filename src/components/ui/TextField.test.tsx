import { render, screen, fireEvent } from "@testing-library/react";
import { TextField } from "./TextField";

describe("TextField", () => {
  it("renders an input element", () => {
    render(<TextField placeholder="Enter text" />);
    expect(screen.getByPlaceholderText("Enter text")).toBeInTheDocument();
  });

  it("renders a label when provided", () => {
    render(<TextField label="Email" />);
    expect(screen.getByLabelText("Email")).toBeInTheDocument();
  });

  it("derives the id from the label text", () => {
    render(<TextField label="Client ID" />);
    const input = screen.getByLabelText("Client ID");
    expect(input).toHaveAttribute("id", "client-id");
  });

  it("uses a custom id when provided", () => {
    render(<TextField label="Name" id="custom-id" />);
    const input = screen.getByLabelText("Name");
    expect(input).toHaveAttribute("id", "custom-id");
  });

  it("renders without a label", () => {
    render(<TextField placeholder="No label" />);
    const input = screen.getByPlaceholderText("No label");
    expect(input).toBeInTheDocument();
    expect(input.parentElement?.querySelector("label")).toBeNull();
  });

  it("applies sm size classes by default", () => {
    render(<TextField placeholder="sm" />);
    const input = screen.getByPlaceholderText("sm");
    expect(input.className).toContain("h-8");
    expect(input.className).toContain("text-control");
  });

  it("applies md size classes", () => {
    render(<TextField size="md" placeholder="md" />);
    const input = screen.getByPlaceholderText("md");
    expect(input.className).toContain("h-9");
    expect(input.className).toContain("text-copy");
  });

  it("uses the shared focus ring rather than a border-colour change", () => {
    render(<TextField placeholder="focus" />);
    expect(screen.getByPlaceholderText("focus").className).toContain("focus-ring");
  });

  it("displays an error message", () => {
    render(<TextField error="Required field" />);
    expect(screen.getByText("Required field")).toBeInTheDocument();
  });

  it("applies the danger border when error is present", () => {
    render(<TextField error="Invalid" placeholder="err" />);
    const input = screen.getByPlaceholderText("err");
    expect(input.className).toContain("border-danger-solid");
    expect(input.className).not.toContain("border-outline");
  });

  it("applies the default border when no error", () => {
    render(<TextField placeholder="ok" />);
    const input = screen.getByPlaceholderText("ok");
    expect(input.className).toContain("border-outline");
    expect(input.className).not.toContain("border-danger-solid");
  });

  it("wires the error message to the input for assistive technology", () => {
    render(<TextField label="Email" error="Invalid" />);
    const input = screen.getByLabelText("Email");
    expect(input).toHaveAttribute("aria-invalid", "true");
    expect(input).toHaveAccessibleDescription("Invalid");
  });

  it("wires a hint to the input and drops it once there is an error", () => {
    const { rerender } = render(<TextField label="Email" hint="Work address" />);
    expect(screen.getByLabelText("Email")).toHaveAccessibleDescription("Work address");
    rerender(<TextField label="Email" hint="Work address" error="Invalid" />);
    expect(screen.getByLabelText("Email")).toHaveAccessibleDescription("Invalid");
  });

  it("passes through value and onChange", () => {
    const onChange = vi.fn();
    render(<TextField value="hello" onChange={onChange} />);
    const input = screen.getByDisplayValue("hello");
    fireEvent.change(input, { target: { value: "world" } });
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it("passes through type, placeholder, and disabled props", () => {
    render(<TextField type="password" placeholder="secret" disabled />);
    const input = screen.getByPlaceholderText("secret");
    expect(input).toHaveAttribute("type", "password");
    expect(input).toBeDisabled();
  });

  it("merges custom className on the wrapper div", () => {
    const { container } = render(<TextField className="mt-4" placeholder="wrap" />);
    const wrapper = container.firstChild as HTMLElement;
    expect(wrapper.className).toContain("mt-4");
  });

  it("forwards ref to the input element", () => {
    const ref = { current: null } as React.RefObject<HTMLInputElement | null>;
    render(<TextField ref={ref} placeholder="ref-test" />);
    expect(ref.current).toBeInstanceOf(HTMLInputElement);
  });

  it("passes through additional HTML attributes", () => {
    render(<TextField data-testid="my-input" autoFocus required />);
    const input = screen.getByTestId("my-input");
    expect(input).toBeRequired();
  });
});
