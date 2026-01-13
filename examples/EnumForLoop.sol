// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

contract OrderBook {
    enum OrderStatus { Pending, Active, Completed, Cancelled }
    enum OrderType { Buy, Sell }

    struct Order {
        uint256 id;
        address user;
        uint256 amount;
        uint256 price;
        OrderStatus status;
        OrderType orderType;
    }

    mapping(uint256 => Order) public orders;
    uint256[] public orderIds;
    uint256 public nextOrderId;

    event OrderCreated(uint256 indexed orderId, address indexed user, OrderType orderType);
    event OrderStatusChanged(uint256 indexed orderId, OrderStatus oldStatus, OrderStatus newStatus);

    function createOrder(uint256 amount, uint256 price, OrderType orderType) public returns (uint256) {
        uint256 orderId = nextOrderId;
        nextOrderId += 1;

        orders[orderId] = Order({
            id: orderId,
            user: msg.sender,
            amount: amount,
            price: price,
            status: OrderStatus.Pending,
            orderType: orderType
        });

        orderIds.push(orderId);
        emit OrderCreated(orderId, msg.sender, orderType);

        return orderId;
    }

    function cancelOrder(uint256 orderId) public {
        Order storage order = orders[orderId];
        require(order.user == msg.sender, "Not order owner");
        require(order.status == OrderStatus.Active, "Order not active");

        OrderStatus oldStatus = order.status;
        order.status = OrderStatus.Cancelled;

        emit OrderStatusChanged(orderId, oldStatus, OrderStatus.Cancelled);
    }

    function getActiveOrders() public view returns (uint256[] memory) {
        uint256 activeCount = 0;

        // First pass: count active orders
        for (uint256 i = 0; i < orderIds.length; i++) {
            if (orders[orderIds[i]].status == OrderStatus.Active) {
                activeCount += 1;
            }
        }

        // Second pass: collect active order IDs
        uint256[] memory activeOrders = new uint256[](activeCount);
        uint256 index = 0;
        for (uint256 i = 0; i < orderIds.length; i++) {
            if (orders[orderIds[i]].status == OrderStatus.Active) {
                activeOrders[index] = orderIds[i];
                index += 1;
            }
        }

        return activeOrders;
    }

    function sumPrices(uint256 count) public view returns (uint256) {
        uint256 total = 0;
        for (uint256 i = 0; i < count; i++) {
            total += orders[orderIds[i]].price;
        }
        return total;
    }
}
