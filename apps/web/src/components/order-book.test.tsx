/**
 * @vitest-environment jsdom
 */
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { OrderBook } from "./order-book";

describe("OrderBook", () => {
  it("renders mock levels", () => {
    render(
      <OrderBook
        orderBook={{
          bids: [{ price: "100", quantity: "2" }],
          asks: [{ price: "101", quantity: "3" }],
        }}
      />,
    );
    expect(screen.getByText("100")).toBeTruthy();
    expect(screen.getByText("101")).toBeTruthy();
  });
});