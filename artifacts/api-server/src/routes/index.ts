import { Router, type IRouter } from "express";
import healthRouter from "./health";
import minecraftRouter from "./minecraft";

const router: IRouter = Router();

router.use(healthRouter);
router.use(minecraftRouter);

export default router;
