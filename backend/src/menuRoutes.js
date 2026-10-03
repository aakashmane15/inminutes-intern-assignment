import { Router } from "express";
import { prisma } from "./db.js";

const router = Router();

router.get("/menu", async (req, res) => {
  try {
    const menuItems = await prisma.menuItem.findMany({
      where: {
        active: true,
      },
      orderBy: {
        name: "asc",
      },
      select: {
        id: true,
        name: true,
        description: true,
        pricePaise: true,
        stock: true,
        version: true,
      },
    });

    res.json(menuItems);
  } catch (error) {
    console.error("Error loading menu: ", error);
  }
});

export default router;
