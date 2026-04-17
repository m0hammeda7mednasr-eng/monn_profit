import {
  applyPermissionDependencies,
  normalizeClientPermissions,
  setPermissionWithDependencies,
} from "./permissionState";

describe("permissionState", () => {
  test("order edit permission automatically enables order view", () => {
    expect(
      normalizeClientPermissions({
        can_view_orders: false,
        can_edit_orders: true,
      }),
    ).toEqual(
      expect.objectContaining({
        can_view_orders: true,
        can_edit_orders: true,
      }),
    );
  });

  test("warehouse scanner permission enables warehouse view and barcode printing", () => {
    expect(
      normalizeClientPermissions({
        can_view_warehouse: false,
        can_edit_warehouse: true,
        can_print_barcode_labels: false,
      }),
    ).toEqual(
      expect.objectContaining({
        can_view_warehouse: true,
        can_edit_warehouse: true,
        can_print_barcode_labels: true,
      }),
    );
  });

  test("turning off warehouse view removes warehouse edit", () => {
    expect(
      applyPermissionDependencies({
        can_view_warehouse: false,
        can_edit_warehouse: true,
      }),
    ).toEqual(
      expect.objectContaining({
        can_view_warehouse: true,
        can_edit_warehouse: true,
        can_print_barcode_labels: true,
      }),
    );

    expect(
      setPermissionWithDependencies(
        {
          can_view_warehouse: true,
          can_edit_warehouse: true,
          can_print_barcode_labels: true,
        },
        "can_view_warehouse",
        false,
      ),
    ).toEqual(
      expect.objectContaining({
        can_view_warehouse: false,
        can_edit_warehouse: false,
        can_print_barcode_labels: true,
      }),
    );
  });
});
